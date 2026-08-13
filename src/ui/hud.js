import './hud.css';

/**
 * Macrion HUD — owned by the UI builder.
 *
 * Implements the on-screen overlay: health bar, objective tracker, interaction prompts,
 * dialogue system, and transient notifications. All DOM elements hide together when
 * setVisible(false) is called (which happens before every capture).
 */

export function createHUD(ctx) {
  // Root container — toggled by setVisible
  const root = document.getElementById('hud');
  if (!root) {
    console.error('HUD root element not found');
    return { name: 'hud', update() {}, setVisible() {}, toast() {}, dialogue() {}, prompt() {}, setObjective() {}, setHealth() {} };
  }

  // Store current context for time-based operations
  let currentCtx = ctx;

  // Create DOM structure
  const createElements = () => {
    // Health bar (bottom-left)
    const healthContainer = document.createElement('div');
    healthContainer.className = 'hud-health';

    const healthLabel = document.createElement('div');
    healthLabel.className = 'health-label';
    healthLabel.textContent = 'Health';

    const healthBar = document.createElement('div');
    healthBar.className = 'health-bar';

    const healthFill = document.createElement('div');
    healthFill.className = 'health-fill';
    healthBar.appendChild(healthFill);

    healthContainer.appendChild(healthLabel);
    healthContainer.appendChild(healthBar);

    // Objective tracker (top-right)
    const objectiveContainer = document.createElement('div');
    objectiveContainer.className = 'hud-objective';

    const objectiveLabel = document.createElement('div');
    objectiveLabel.className = 'objective-label';
    objectiveLabel.textContent = 'Objective';

    const objectiveText = document.createElement('div');
    objectiveText.className = 'objective-text';

    objectiveContainer.appendChild(objectiveLabel);
    objectiveContainer.appendChild(objectiveText);

    // Interaction prompt (center, below middle)
    const promptContainer = document.createElement('div');
    promptContainer.className = 'hud-prompt';

    const promptText = document.createElement('div');
    promptText.className = 'prompt-text';

    promptContainer.appendChild(promptText);

    // Dialogue box (bottom third)
    const dialogueContainer = document.createElement('div');
    dialogueContainer.className = 'hud-dialogue';

    const dialogueSpeaker = document.createElement('div');
    dialogueSpeaker.className = 'dialogue-speaker';

    const dialogueText = document.createElement('div');
    dialogueText.className = 'dialogue-text';

    const dialogueContinue = document.createElement('div');
    dialogueContinue.className = 'dialogue-continue';
    dialogueContinue.textContent = '[Space/E to continue]';

    dialogueContainer.appendChild(dialogueSpeaker);
    dialogueContainer.appendChild(dialogueText);
    dialogueContainer.appendChild(dialogueContinue);

    // Toast notifications (top center)
    const toastContainer = document.createElement('div');
    toastContainer.className = 'hud-toast-container';

    return {
      root,
      health: { container: healthContainer, fill: healthFill },
      objective: { container: objectiveContainer, text: objectiveText },
      prompt: { container: promptContainer, text: promptText },
      dialogue: {
        container: dialogueContainer,
        speaker: dialogueSpeaker,
        text: dialogueText,
        continue: dialogueContinue,
      },
      toast: { container: toastContainer },
    };
  };

  const dom = createElements();

  // Append all elements to root (initially hidden by index.html's CSS)
  root.appendChild(dom.health.container);
  root.appendChild(dom.objective.container);
  root.appendChild(dom.prompt.container);
  root.appendChild(dom.dialogue.container);
  root.appendChild(dom.toast.container);

  // State management
  let isVisible = false;
  let currentHealth = 100;
  let maxHealth = 100;
  let currentDialogue = null;
  let dialogueIndex = 0;
  let toasts = [];
  let lastToastCleanupTime = 0;

  // Handle dialogue advancement
  const handleDialogueKey = (e) => {
    if (!currentDialogue) return;
    if (e.code === 'Space' || e.code === 'KeyE') {
      e.preventDefault();
      dialogueIndex++;
      if (dialogueIndex >= currentDialogue.length) {
        // Dialogue finished
        currentDialogue = null;
        dialogueIndex = 0;
        updateDialogueDisplay();
        document.removeEventListener('keydown', handleDialogueKey);
      } else {
        updateDialogueDisplay();
      }
    }
  };

  const updateDialogueDisplay = () => {
    if (currentDialogue && dialogueIndex < currentDialogue.length) {
      const line = currentDialogue[dialogueIndex];
      dom.dialogue.speaker.textContent = line.speaker || '';
      dom.dialogue.text.textContent = line.text || '';
      dom.dialogue.container.classList.add('active');
      document.addEventListener('keydown', handleDialogueKey);
    } else {
      dom.dialogue.container.classList.remove('active');
      document.removeEventListener('keydown', handleDialogueKey);
    }
  };

  const updateHealthBar = () => {
    const percent = maxHealth > 0 ? (currentHealth / maxHealth) * 100 : 0;
    dom.health.fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    if (percent <= 25) {
      dom.health.fill.classList.add('low');
    } else {
      dom.health.fill.classList.remove('low');
    }
  };

  const updatePromptDisplay = () => {
    if (dom.prompt.text.textContent.trim()) {
      dom.prompt.container.classList.add('active');
    } else {
      dom.prompt.container.classList.remove('active');
    }
  };

  return {
    name: 'hud',

    update(ctx) {
      // Update stored context for toast timing (deterministic via ctx.time)
      currentCtx = ctx;

      // Remove expired toasts (2.5 second lifetime)
      const now = ctx.time;
      toasts = toasts.filter((t) => now - t.created < 2.5);

      // Rebuild toast display
      dom.toast.container.innerHTML = '';
      for (const t of toasts) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = t.text;
        dom.toast.container.appendChild(el);
      }
    },

    setVisible(v) {
      isVisible = v;
      root.classList.toggle('hidden', !v);
    },

    toast(msg) {
      if (!msg) return;
      // Toast lifetime is deterministic and driven by ctx.time in update()
      // For now, store current ctx.time (will be set on first update after toast creation)
      toasts.push({
        text: msg,
        created: ctx.time,
      });
    },

    dialogue(lines) {
      if (!lines || lines.length === 0) {
        currentDialogue = null;
        dialogueIndex = 0;
        updateDialogueDisplay();
      } else {
        currentDialogue = lines;
        dialogueIndex = 0;
        updateDialogueDisplay();
      }
    },

    prompt(text) {
      if (text === null || text === undefined) {
        dom.prompt.text.textContent = '';
      } else {
        dom.prompt.text.textContent = text;
      }
      updatePromptDisplay();
    },

    setObjective(text) {
      if (text === null || text === undefined) {
        dom.objective.container.classList.remove('active');
        dom.objective.text.textContent = '';
      } else {
        dom.objective.text.textContent = text;
        dom.objective.container.classList.add('active');
      }
    },

    setHealth(cur, max) {
      currentHealth = Math.max(0, cur);
      maxHealth = Math.max(1, max);
      updateHealthBar();
    },
  };
}
