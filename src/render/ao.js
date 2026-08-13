/**
 * Macrion — depth-only ambient occlusion (contact darkening).
 *
 * Why not GTAOPass/SSAOPass: both re-render the whole scene into a normal
 * G-buffer. On this scene the depth pass is already the dominant frame cost
 * (see the shadow-map note in sky.js), so a second full geometry pass is not
 * affordable. This reconstructs view-space position from the depth buffer we
 * already have and derives the normal from its screen-space derivatives, so it
 * costs one full-screen pass and no extra geometry.
 *
 * Sampling is a fixed 8-direction x 2-radius spiral rather than a randomly
 * rotated kernel. That trades a little banding for being *noise-free*, which
 * means no denoise pass — and it keeps captures deterministic.
 *
 * The pass is also the blit that moves the scene out of its own render target
 * and into the composer chain, so AO costs one shader, not one extra pass.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Renders the scene into a target that owns a DepthTexture. */
export class SceneDepthPass extends Pass {
  constructor(scene, camera, target) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.target = target;
    this.needsSwap = false;
  }

  setSize(w, h) { this.target.setSize(w, h); }

  render(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }
}

const AOShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uProjInv: { value: new THREE.Matrix4() },
    uNear: { value: 0.25 },
    uFar: { value: 8000 },
    uProjScale: { value: 1000 },
    uRadius: { value: 1.1 },
    uIntensity: { value: 0.85 },
    uTint: { value: new THREE.Vector3(0.62, 0.70, 0.86) },
    uPower: { value: 1.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2  uResolution;
    uniform mat4  uProjInv;
    uniform float uNear;
    uniform float uFar;
    uniform float uProjScale;
    uniform float uRadius;
    uniform float uIntensity;
    uniform vec3  uTint;
    uniform float uPower;
    varying vec2 vUv;

    vec3 viewPos( vec2 uv, out float rawZ ) {
      rawZ = texture2D( tDepth, uv ).x;
      vec4 p = uProjInv * vec4( uv * 2.0 - 1.0, rawZ * 2.0 - 1.0, 1.0 );
      return p.xyz / p.w;
    }

    void main() {
      vec3 color = texture2D( tDiffuse, vUv ).rgb;

      float z0;
      vec3 P = viewPos( vUv, z0 );
      if ( z0 >= 0.99995 ) { gl_FragColor = vec4( color, 1.0 ); return; }

      vec3 N = normalize( cross( dFdx( P ), dFdy( P ) ) );
      if ( N.z < 0.0 ) N = -N;

      // world radius -> pixels at this depth
      float rpx = clamp( uRadius * uProjScale / max( -P.z, 0.05 ), 3.0, 110.0 );

      float occ = 0.0;
      const int DIRS = 8;
      for ( int i = 0; i < DIRS; i ++ ) {
        float a = ( float( i ) + 0.5 ) * 0.7853981634;   // 2PI / 8
        vec2 dir = vec2( cos( a ), sin( a ) );
        for ( int k = 0; k < 2; k ++ ) {
          float r = ( k == 0 ) ? 0.42 : 1.0;
          vec2 uv = vUv + dir * ( rpx * r ) / uResolution;
          float zs;
          vec3 S = viewPos( uv, zs );
          if ( zs >= 0.99995 ) continue;
          vec3 v = S - P;
          float d = length( v );
          if ( d < 1e-4 ) continue;
          // range check keeps far silhouettes from bleeding onto near surfaces
          float att = uRadius * uRadius / ( uRadius * uRadius + d * d );
          occ += max( dot( N, v / d ) - 0.10, 0.0 ) * att;
        }
      }
      occ /= float( DIRS * 2 );

      float ao = clamp( 1.0 - pow( clamp( occ * uIntensity * 2.6, 0.0, 1.0 ), uPower ), 0.0, 1.0 );
      // occluded regions darken *and* cool slightly — crevices see only sky
      vec3 occCol = color * mix( uTint, vec3( 1.0 ), ao );
      gl_FragColor = vec4( mix( occCol, color, ao ), 1.0 );
    }
  `,
};

/** Applies AO while blitting the scene target into the composer chain. */
export class AOCompositePass extends Pass {
  constructor(sourceRT, camera) {
    super();
    this.source = sourceRT;
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(AOShader.uniforms),
      vertexShader: AOShader.vertexShader,
      fragmentShader: AOShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.material.__macrionOptOut = true;
    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = true;
    this.enabled = true;
  }

  setSize(w, h) {
    this.material.uniforms.uResolution.value.set(w, h);
    this._h = h;
  }

  render(renderer, writeBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = this.source.texture;
    u.tDepth.value = this.source.depthTexture;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    const h = this._h ?? renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    u.uProjScale.value = 0.5 * h / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
