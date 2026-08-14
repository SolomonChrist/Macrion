// Port comes from the environment so the HMR client dials the same port the
// server is on. Passing `--port N` on the CLI does NOT update the injected HMR
// client URL, which still targets the config port — that mismatch produced a
// 400 websocket handshake and 3 phantom `consoleErrors` in every capture run
// on a non-default port. Caught during Wave 1; captures now set MACRION_PORT.
const PORT = Number(process.env.MACRION_PORT) || 5188;

export default {
  server: { port: PORT, strictPort: true, hmr: { port: PORT } },
  build: { target: 'esnext' },
};
