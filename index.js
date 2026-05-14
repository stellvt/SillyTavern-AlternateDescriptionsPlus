/*
 * Alternate Descriptions Plus for SillyTavern
 * Character field alternates + persona description alternates.
 * Character storage is compatible with Alternate Fields: extensions.alternate_fields.*
 */

import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import {
  ARGUMENT_TYPE,
  SlashCommandNamedArgument,
} from "../../../slash-commands/SlashCommandArgument.js";
import {
  SlashCommandEnumValue,
  enumTypes,
} from "../../../slash-commands/SlashCommandEnumValue.js";
import { extension_settings } from "../../../extensions.js";
import {
  eventSource,
  event_types,
  saveSettingsDebounced,
} from "../../../../script.js";
import { power_user } from "../../../power-user.js";
import { user_avatar } from "../../../personas.js";

const EXT_ID = "alternate_descriptions_plus";
const LOG_PREFIX = "[Alternate Descriptions Plus]";

const defaultSettings = {
  enableCharacterFields: true,
  enablePersonaFields: true,
  autoSaveFirstVersion: true,
  warnUnsavedChanges: true,
  showTokenCounts: true,
  enabledCharacterFieldKeys: {
    description: true,
    personality: true,
    scenario: true,
    example_dialogue: true,
    main_prompt: true,
    post_history_instructions: true,
  },
  personas: {},
};

const characterFieldConfigs = [
  {
    scope: "character",
    field: "description",
    fieldKey: "description",
    buttonName: "Descriptions",
    singularName: "description",
    selector: "#description_div",
    injectPoint: "#character_open_media_overrides",
    textarea: "description_textarea",
    saveKey: "alt_descriptions",
  },
  {
    scope: "character",
    field: "personality",
    fieldKey: "personality",
    buttonName: "Personalities",
    singularName: "personality",
    selector: "#personality_div",
    injectPoint: ".notes-link",
    textarea: "personality_textarea",
    saveKey: "alt_personalities",
  },
  {
    scope: "character",
    field: "scenario",
    fieldKey: "scenario",
    buttonName: "Scenarios",
    singularName: "scenario",
    selector: "#scenario_div",
    injectPoint: ".notes-link",
    textarea: "scenario_pole",
    saveKey: "alt_scenarios",
  },
  {
    scope: "character",
    field: "example dialogue",
    fieldKey: "example_dialogue",
    buttonName: "Example Dialogue",
    singularName: "example dialogue",
    selector: "#mes_example_div",
    injectPoint: ".editor_maximize",
    textarea: "mes_example_textarea",
    saveKey: "alt_example_dialogue",
  },
  {
    scope: "character",
    field: "main prompt",
    fieldKey: "main_prompt",
    buttonName: "Main Prompts",
    singularName: "main prompt",
    selector: "#system_prompt_textarea",
    injectPoint: ".editor_maximize",
    textarea: "system_prompt_textarea",
    saveKey: "alt_main_prompts",
  },
  {
    scope: "character",
    field: "post-history instructions",
    fieldKey: "post_history_instructions",
    buttonName: "Post-History Instructions",
    singularName: "post-history instructions",
    selector: "#post_history_instructions_textarea",
    injectPoint: ".editor_maximize",
    textarea: "post_history_instructions_textarea",
    saveKey: "alt_post_history",
  },
];

const personaFieldConfig = {
  scope: "persona",
  field: "description",
  fieldKey: "description",
  buttonName: "Persona Descriptions",
  singularName: "persona description",
  selector: null,
  injectPoint: null,
  textarea: null,
  saveKey: "alt_descriptions",
};

const saveTimeouts = new Map();
const tokenTimeouts = new Map();

function getContext() {
  return SillyTavern.getContext();
}

function ensureSettings() {
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = structuredClone(defaultSettings);
  }

  const settings = extension_settings[EXT_ID];
  for (const [key, value] of Object.entries(defaultSettings)) {
    if (settings[key] === undefined) {
      settings[key] = structuredClone(value);
    }
  }

  if (!settings.enabledCharacterFieldKeys) {
    settings.enabledCharacterFieldKeys = structuredClone(
      defaultSettings.enabledCharacterFieldKeys,
    );
  }

  for (const [key, value] of Object.entries(
    defaultSettings.enabledCharacterFieldKeys,
  )) {
    if (settings.enabledCharacterFieldKeys[key] === undefined) {
      settings.enabledCharacterFieldKeys[key] = value;
    }
  }

  if (!settings.personas) {
    settings.personas = {};
  }

  return settings;
}

function generateId() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `adp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeEntries(entries, defaultTitle) {
  if (!Array.isArray(entries)) {
    return [];
  }

  let changed = false;
  const normalized = entries.map((entry, index) => {
    const timestamp = nowIso();
    if (typeof entry === "string") {
      changed = true;
      return {
        id: generateId(),
        title: `${defaultTitle} #${index + 1}`,
        content: entry,
        createdAt: timestamp,
        updatedAt: timestamp,
        source: "migrated",
      };
    }

    const content = String(entry?.content ?? entry?.description ?? "");
    const normalizedEntry = {
      id: entry?.id || generateId(),
      title: String(entry?.title || `${defaultTitle} #${index + 1}`),
      content,
      createdAt: entry?.createdAt || timestamp,
      updatedAt: entry?.updatedAt || timestamp,
      source:
        entry?.source ||
        (entry?.description !== undefined ? "migrated" : "manual"),
    };

    if (
      !entry?.id ||
      !entry?.title ||
      entry?.content === undefined ||
      entry?.createdAt === undefined ||
      entry?.updatedAt === undefined
    ) {
      changed = true;
    }

    return normalizedEntry;
  });

  return { entries: normalized, changed };
}

class CharacterUtil {
  static getCharacterId() {
    const context = getContext();
    let characterId = context.characterId;

    if (context.groupId) {
      const avatarUrlInput = document.getElementById("avatar_url_pole");
      if (avatarUrlInput instanceof HTMLInputElement) {
        const avatarUrl = avatarUrlInput.value;
        const foundId = context.characters.findIndex(
          (character) => character.avatar === avatarUrl,
        );
        if (foundId !== -1) {
          characterId = foundId;
        }
      }
    }

    return characterId;
  }

  static getName() {
    const context = getContext();
    if (context.menuType === "create") {
      return context.createCharacterData?.name || "New Character";
    }

    const characterId = this.getCharacterId();
    return context.characters?.[characterId]?.data?.name || "Unknown Character";
  }

  static migrateLegacyDescriptions() {
    const context = getContext();
    if (context.menuType === "create") {
      const legacy =
        context.createCharacterData?.extensions?.alternate_descriptions;
      if (legacy?.length) {
        const { entries } = normalizeEntries(legacy, "Description");
        if (!context.createCharacterData.extensions.alternate_fields) {
          context.createCharacterData.extensions.alternate_fields = {};
        }
        if (
          !context.createCharacterData.extensions.alternate_fields
            .alt_descriptions?.length
        ) {
          context.createCharacterData.extensions.alternate_fields.alt_descriptions =
            entries;
        }
        delete context.createCharacterData.extensions.alternate_descriptions;
      }
      return;
    }

    const characterId = this.getCharacterId();
    const character = context.characters?.[characterId];
    const legacy = character?.data?.extensions?.alternate_descriptions;
    if (!legacy?.length) {
      return;
    }

    if (!character.data.extensions.alternate_fields) {
      character.data.extensions.alternate_fields = {};
    }

    if (!character.data.extensions.alternate_fields.alt_descriptions?.length) {
      const { entries } = normalizeEntries(legacy, "Description");
      character.data.extensions.alternate_fields.alt_descriptions = entries;
      context.writeExtensionField(
        characterId,
        "alternate_fields",
        character.data.extensions.alternate_fields,
      );
    }

    delete character.data.extensions.alternate_descriptions;
    context.writeExtensionField(
      characterId,
      "alternate_descriptions",
      undefined,
    );
    console.log(`${LOG_PREFIX} migrated legacy alternate_descriptions`);
  }

  static getCurrentField(field) {
    const textarea = document.getElementById(field.textarea);
    return textarea ? textarea.value : "";
  }

  static setCurrentField(field, value) {
    const textarea = document.getElementById(field.textarea);
    if (!textarea) {
      return false;
    }

    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  static getFieldData(field) {
    this.migrateLegacyDescriptions();
    const context = getContext();
    let rawEntries = [];

    if (context.menuType === "create") {
      rawEntries =
        context.createCharacterData?.extensions?.alternate_fields?.[
          field.saveKey
        ] || [];
    } else {
      const characterId = this.getCharacterId();
      rawEntries =
        context.characters?.[characterId]?.data?.extensions?.alternate_fields?.[
          field.saveKey
        ] || [];
    }

    const { entries, changed } = normalizeEntries(
      rawEntries,
      field.buttonName.replace(/s$/, ""),
    );
    if (changed) {
      this.saveFieldData(field, entries);
    }
    return entries;
  }

  static saveFieldData(field, fieldData) {
    const context = getContext();
    if (context.menuType === "create") {
      if (!context.createCharacterData.extensions) {
        context.createCharacterData.extensions = {};
      }
      if (!context.createCharacterData.extensions.alternate_fields) {
        context.createCharacterData.extensions.alternate_fields = {};
      }
      context.createCharacterData.extensions.alternate_fields[field.saveKey] =
        fieldData;
      return;
    }

    const characterId = this.getCharacterId();
    const character = context.characters?.[characterId];
    if (!character) {
      return;
    }

    if (!character.data.extensions) {
      character.data.extensions = {};
    }
    if (!character.data.extensions.alternate_fields) {
      character.data.extensions.alternate_fields = {};
    }

    character.data.extensions.alternate_fields[field.saveKey] = fieldData;
    context.writeExtensionField(
      characterId,
      "alternate_fields",
      character.data.extensions.alternate_fields,
    );
  }
}

class PersonaUtil {
  static getCandidateTextareas() {
    const selectors = [
      "#persona_description",
      "#persona_description_textarea",
      "#user_persona_textarea",
      "#persona_textarea",
      "#personaDescription",
      'textarea[name="persona_description"]',
      'textarea[name="description"]',
      '[id*="persona" i] textarea',
      'textarea[id*="persona" i]',
    ];

    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(
        (element) =>
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLInputElement,
      );
  }

  static getTextarea() {
    const visibleCandidates = this.getCandidateTextareas().filter(
      (element) => element.offsetParent !== null || element.checkVisibility?.(),
    );
    return visibleCandidates[0] || this.getCandidateTextareas()[0] || null;
  }

  static getPersonaObject() {
    const context = getContext();
    const candidates = [
      power_user.persona_descriptions?.[user_avatar],
      getContext().power_user?.persona,
      getContext().power_user?.personas?.[getContext().power_user?.persona],
      getContext().personas?.[getContext().persona],
      getContext().personas?.[getContext().power_user?.persona],
      getContext().currentPersona,
      getContext().activePersona,
    ];

    return (
      candidates.find(
        (candidate) => candidate && typeof candidate === "object",
      ) || null
    );
  }

  static getPersonaKey() {
    const context = getContext();
    const personaObject = this.getPersonaObject();
    const directCandidates = [
      user_avatar,
      context.power_user?.persona,
      context.persona,
      context.currentPersonaId,
      context.activePersonaId,
      personaObject?.id,
      personaObject?.avatar,
      personaObject?.name,
      personaObject?.description,
    ].filter((value) => typeof value === "string" && value.trim());

    if (directCandidates.length) {
      return directCandidates[0];
    }

    const textarea = this.getTextarea();
    if (textarea?.value?.trim()) {
      return `description:${textarea.value.trim().slice(0, 80)}`;
    }

    return "default_persona";
  }

  static getName() {
    const personaObject = this.getPersonaObject();
    const context = getContext();
    return (
      power_user.personas?.[user_avatar] ||
      personaObject?.name ||
      context.power_user?.persona ||
      context.persona ||
      "Current Persona"
    );
  }

  static getCurrentField() {
    const textarea = this.getTextarea();
    return textarea
      ? textarea.value
      : String(power_user.persona_description || "");
  }

  static setCurrentField(value) {
    const textarea = this.getTextarea();
    power_user.persona_description = value;

    if (user_avatar && power_user.persona_descriptions?.[user_avatar]) {
      power_user.persona_descriptions[user_avatar].description = value;
    }

    if (textarea) {
      textarea.value = value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }

    saveSettingsDebounced();
    eventSource.emit(event_types.PERSONA_UPDATED, user_avatar);
    return true;
  }

  static getFieldData(field) {
    const settings = ensureSettings();
    const personaKey = this.getPersonaKey();
    const rawEntries = settings.personas?.[personaKey]?.[field.saveKey] || [];
    const { entries, changed } = normalizeEntries(
      rawEntries,
      "Persona Description",
    );
    if (changed) {
      this.saveFieldData(field, entries);
    }
    return entries;
  }

  static saveFieldData(field, fieldData) {
    const settings = ensureSettings();
    const personaKey = this.getPersonaKey();
    if (!settings.personas[personaKey]) {
      settings.personas[personaKey] = {
        name: this.getName(),
        createdAt: nowIso(),
      };
    }

    settings.personas[personaKey].name = this.getName();
    settings.personas[personaKey].updatedAt = nowIso();
    settings.personas[personaKey][field.saveKey] = fieldData;
    saveSettingsDebounced();
  }
}

function getFieldOwnerName(field) {
  return field.scope === "persona"
    ? PersonaUtil.getName()
    : CharacterUtil.getName();
}

function getCurrentField(field) {
  return field.scope === "persona"
    ? PersonaUtil.getCurrentField(field)
    : CharacterUtil.getCurrentField(field);
}

function setCurrentField(field, value) {
  return field.scope === "persona"
    ? PersonaUtil.setCurrentField(value)
    : CharacterUtil.setCurrentField(field, value);
}

function getFieldData(field) {
  return field.scope === "persona"
    ? PersonaUtil.getFieldData(field)
    : CharacterUtil.getFieldData(field);
}

function saveFieldData(field, fieldData) {
  if (field.scope === "persona") {
    PersonaUtil.saveFieldData(field, fieldData);
  } else {
    CharacterUtil.saveFieldData(field, fieldData);
  }
}

function fieldMatches(entry, currentValue) {
  return (
    String(entry?.content ?? "").trim() === String(currentValue ?? "").trim()
  );
}

function hasUnsavedChanges(fieldData, currentValue) {
  return (
    Boolean(String(currentValue ?? "").trim()) &&
    !fieldData.some((entry) => fieldMatches(entry, currentValue))
  );
}

function updateStatus(container, field, fieldData) {
  const currentValue = getCurrentField(field);
  let status = container.querySelector(".adp_status");
  if (!status) {
    status = document.createElement("div");
    status.className = "adp_status";
    const list = container.querySelector(".adp_field_list");
    list.parentNode.insertBefore(status, list);
  }

  status.classList.remove("adp_status_warning", "adp_status_success");

  if (hasUnsavedChanges(fieldData, currentValue)) {
    status.style.display = "flex";
    status.classList.add("adp_status_warning");
    status.innerHTML = `
            <i class="fa-solid fa-exclamation-triangle"></i>
            <span>Current ${escapeHtml(field.singularName)} has unsaved changes.</span>
            <div class="menu_button menu_button_icon adp_save_current_btn" style="margin-left: auto; font-size: 12px; padding: 4px 8px;">
                <i class="fa-solid fa-save"></i>
                <span>Save Current</span>
            </div>
        `;
    status
      .querySelector(".adp_save_current_btn")
      ?.addEventListener("click", () => {
        fieldData.push(createEntry(field, currentValue));
        saveFieldData(field, fieldData);
        updateFieldList(container, field, fieldData);
      });
    return;
  }

  if (fieldData.some((entry) => fieldMatches(entry, currentValue))) {
    status.style.display = "flex";
    status.classList.add("adp_status_success");
    status.innerHTML = `
            <i class="fa-solid fa-check-circle"></i>
            <span>Current ${escapeHtml(field.singularName)} matches a saved alternate.</span>
        `;
    return;
  }

  status.style.display = "none";
}

function updateActiveIndicators(container, field, fieldData) {
  const currentValue = getCurrentField(field);
  fieldData.forEach((entry, index) => {
    const item = container.querySelector(`[data-adp-item-index="${index}"]`);
    if (!item) {
      return;
    }

    const isActive = fieldMatches(entry, currentValue);
    const indicator = item.querySelector(".adp_active_indicator");
    const useButton = item.querySelector(".adp_use_btn");
    item.classList.toggle("adp_active_field", isActive);
    if (indicator) {
      indicator.innerHTML = isActive
        ? '<i class="fa-solid fa-check-circle" style="color: #28a745; margin-left: 8px;"></i>'
        : "";
    }
    if (useButton) {
      useButton.style.opacity = isActive ? "0.5" : "";
      useButton.title = isActive ? "Already active" : "";
    }
  });

  updateStatus(container, field, fieldData);
}

function createEntry(field, content = "") {
  const fieldData = getFieldData(field);
  const timestamp = nowIso();
  return {
    id: generateId(),
    title: `${field.singularName} #${fieldData.length + 1}`,
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: "manual",
  };
}

async function updateTokenCount(container, index, content) {
  if (!ensureSettings().showTokenCounts) {
    return;
  }

  const tokenDisplay = container.querySelector(
    `[data-adp-token-display="${index}"]`,
  );
  if (!tokenDisplay) {
    return;
  }

  try {
    const count = await getContext().getTokenCountAsync(content || "");
    tokenDisplay.textContent = String(count);
  } catch (error) {
    console.warn(`${LOG_PREFIX} token counting failed`, error);
    tokenDisplay.textContent = "?";
  }
}

function scheduleSave(field, fieldData, key) {
  const saveKey = `${field.scope}:${field.saveKey}:${key}`;
  const existing = saveTimeouts.get(saveKey);
  if (existing) {
    clearTimeout(existing);
  }

  saveTimeouts.set(
    saveKey,
    setTimeout(() => {
      saveFieldData(field, fieldData);
      saveTimeouts.delete(saveKey);
    }, 500),
  );
}

function scheduleTokenUpdate(container, index, content) {
  const tokenKey = `${index}`;
  const existing = tokenTimeouts.get(tokenKey);
  if (existing) {
    clearTimeout(existing);
  }

  tokenTimeouts.set(
    tokenKey,
    setTimeout(() => {
      updateTokenCount(container, index, content);
      tokenTimeouts.delete(tokenKey);
    }, 500),
  );
}

function updateFieldList(container, field, fieldData) {
  const listContainer = container.querySelector(".adp_field_list");
  const currentValue = getCurrentField(field);

  if (!fieldData.length) {
    listContainer.innerHTML = `<div class="adp_empty_notice"><strong>Click <i class="fa-solid fa-plus"></i> Add New to save the current ${escapeHtml(field.singularName)}.</strong></div>`;
    updateStatus(container, field, fieldData);
    return;
  }

  listContainer.innerHTML = fieldData
    .map((entry, index) => {
      const isActive = fieldMatches(entry, currentValue);
      const activeClass = isActive ? "adp_active_field" : "";
      const activeIndicator = isActive
        ? '<i class="fa-solid fa-check-circle" style="color: #28a745; margin-left: 8px;"></i>'
        : "";
      const tokenCounter = ensureSettings().showTokenCounts
        ? `<div class="extension_token_counter adp_token_counter"><span>Tokens:</span> <span data-adp-token-display="${index}">calculating...</span></div>`
        : "";

      return `
            <div class="adp_field_item ${activeClass}" data-adp-item-index="${index}">
                <div class="flex-container justifySpaceBetween">
                    <div class="flex-container adp_title_wrap">
                        <input class="text_pole textarea_compact adp_field_title margin0" data-index="${index}" value="${escapeHtml(entry.title)}" placeholder="${escapeHtml(field.singularName)} title" maxlength="80">
                        <div class="adp_active_indicator">${activeIndicator}</div>
                    </div>
                    <div class="flex-container" style="flex: none; gap: 5px;">
                        <div class="menu_button menu_button_icon adp_use_btn" data-index="${index}" ${isActive ? 'style="opacity: 0.5;" title="Already active"' : ""}>
                            <i class="fa-solid fa-arrow-up"></i>
                            <span>Use</span>
                        </div>
                        <div class="menu_button menu_button_icon adp_duplicate_btn" data-index="${index}">
                            <i class="fa-solid fa-copy"></i>
                            <span>Duplicate</span>
                        </div>
                        <div class="menu_button menu_button_icon adp_delete_btn" data-index="${index}">
                            <i class="fa-solid fa-trash"></i>
                            <span>Delete</span>
                        </div>
                    </div>
                </div>
                <textarea class="text_pole textarea_compact adp_field_textarea" rows="8" data-index="${index}" placeholder="${escapeHtml(field.singularName)}...">${escapeHtml(entry.content)}</textarea>
                ${tokenCounter}
            </div>
        `;
    })
    .join("");

  if (ensureSettings().showTokenCounts) {
    fieldData.forEach((entry, index) =>
      updateTokenCount(container, index, entry.content),
    );
  }

  listContainer.querySelectorAll(".adp_use_btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      const index = Number(event.currentTarget.dataset.index);
      const current = getCurrentField(field);
      if (
        ensureSettings().warnUnsavedChanges &&
        hasUnsavedChanges(fieldData, current)
      ) {
        const confirmed = confirm(
          `Your current ${field.singularName} has unsaved changes. Switch anyway?`,
        );
        if (!confirmed) {
          return;
        }
      }

      if (setCurrentField(field, fieldData[index].content)) {
        updateActiveIndicators(container, field, fieldData);
      }
    });
  });

  listContainer.querySelectorAll(".adp_duplicate_btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      const index = Number(event.currentTarget.dataset.index);
      const source = fieldData[index];
      const timestamp = nowIso();
      fieldData.splice(index + 1, 0, {
        ...structuredClone(source),
        id: generateId(),
        title: `${source.title} Copy`,
        createdAt: timestamp,
        updatedAt: timestamp,
        source: "manual",
      });
      saveFieldData(field, fieldData);
      updateFieldList(container, field, fieldData);
    });
  });

  listContainer.querySelectorAll(".adp_delete_btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      const index = Number(event.currentTarget.dataset.index);
      const confirmed = confirm(
        `Are you sure you want to delete "${fieldData[index].title}"? This action cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }

      fieldData.splice(index, 1);
      saveFieldData(field, fieldData);
      updateFieldList(container, field, fieldData);
    });
  });

  listContainer.querySelectorAll(".adp_field_textarea").forEach((textarea) => {
    textarea.addEventListener("input", (event) => {
      const index = Number(event.target.dataset.index);
      fieldData[index].content = event.target.value;
      fieldData[index].updatedAt = nowIso();
      setTimeout(() => updateActiveIndicators(container, field, fieldData), 50);
      scheduleSave(field, fieldData, `content:${index}`);
      scheduleTokenUpdate(container, index, fieldData[index].content);
    });
  });

  listContainer.querySelectorAll(".adp_field_title").forEach((input) => {
    input.addEventListener("input", (event) => {
      const index = Number(event.target.dataset.index);
      fieldData[index].title = event.target.value;
      fieldData[index].updatedAt = nowIso();
      scheduleSave(field, fieldData, `title:${index}`);
    });
  });

  updateStatus(container, field, fieldData);
}

function setupFieldMonitoring(container, field, fieldData) {
  const getElement = () =>
    field.scope === "persona"
      ? PersonaUtil.getTextarea()
      : document.getElementById(field.textarea);
  const mainInput = getElement();
  if (!mainInput) {
    return;
  }

  const checkStatus = () =>
    setTimeout(() => updateActiveIndicators(container, field, fieldData), 50);
  mainInput.addEventListener("input", checkStatus);
  mainInput.addEventListener("paste", checkStatus);
  mainInput.addEventListener("change", checkStatus);

  const observer = new MutationObserver(() => {
    if (!document.contains(container)) {
      mainInput.removeEventListener("input", checkStatus);
      mainInput.removeEventListener("paste", checkStatus);
      mainInput.removeEventListener("change", checkStatus);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function createPopupContent(field) {
  let fieldData = getFieldData(field);
  let currentValue = getCurrentField(field);

  if (
    ensureSettings().autoSaveFirstVersion &&
    fieldData.length === 0 &&
    currentValue.trim()
  ) {
    fieldData = [createEntry(field, currentValue)];
    saveFieldData(field, fieldData);
  }

  const ownerName = getFieldOwnerName(field);
  const container = document.createElement("div");
  container.className = "flex-container flexFlowColumn adp_popup";

  container.innerHTML = `
        <div class="flex-container justifySpaceBetween alignItemsCenter">
            <h3 class="margin0">Alternate ${escapeHtml(field.buttonName)} for <span>${escapeHtml(ownerName)}</span></h3>
            <div class="flex-container" style="gap: 5px;">
                <div class="menu_button menu_button_icon adp_save_current_top_btn">
                    <i class="fa-solid fa-save"></i>
                    <span>Save Current</span>
                </div>
                <div class="menu_button menu_button_icon adp_add_btn">
                    <i class="fa-solid fa-plus"></i>
                    <span>Add New</span>
                </div>
            </div>
        </div>
        <hr>
        <div class="justifyLeft">
            <small>
                Save different versions of this ${escapeHtml(field.singularName)}. Click "Use" to switch the active text in the editor.
            </small>
        </div>
        <hr>
        <div class="adp_field_list"></div>
    `;

  container.querySelector(".adp_add_btn")?.addEventListener("click", () => {
    currentValue = getCurrentField(field);
    fieldData.push(createEntry(field, currentValue || ""));
    saveFieldData(field, fieldData);
    updateFieldList(container, field, fieldData);
  });

  container
    .querySelector(".adp_save_current_top_btn")
    ?.addEventListener("click", () => {
      currentValue = getCurrentField(field);
      fieldData.push(createEntry(field, currentValue || ""));
      saveFieldData(field, fieldData);
      updateFieldList(container, field, fieldData);
    });

  updateFieldList(container, field, fieldData);
  setupFieldMonitoring(container, field, fieldData);
  return container;
}

function createButton(field) {
  const button = document.createElement("div");
  button.className = `menu_button menu_button_icon adp_button adp_${field.scope}_${field.saveKey}_button`;
  button.title = `Manage alternate ${field.singularName}s`;
  button.innerHTML = `<i class="fa-solid fa-bars-staggered"></i><span>Alt. ${escapeHtml(field.buttonName)}</span>`;
  button.addEventListener("click", () => {
    const popupContent = createPopupContent(field);
    getContext().callPopup(popupContent, "text", "", {
      wide: true,
      large: true,
    });
  });
  return button;
}

function waitForElement(selector, callback, attempts = 100) {
  const element = document.querySelector(selector);
  if (element) {
    callback(element);
    return;
  }

  if (attempts <= 0) {
    return;
  }

  setTimeout(() => waitForElement(selector, callback, attempts - 1), 100);
}

function injectCharacterButton(field) {
  if (
    !ensureSettings().enableCharacterFields ||
    !ensureSettings().enabledCharacterFieldKeys[field.fieldKey]
  ) {
    return;
  }

  waitForElement(field.selector, (element) => {
    if (document.querySelector(`.adp_${field.scope}_${field.saveKey}_button`)) {
      return;
    }

    const button = createButton(field);
    if (field.selector.startsWith("#") && field.selector.includes("textarea")) {
      const parentDiv = element.closest("div") || element.parentElement;
      const injectElement = parentDiv?.querySelector(field.injectPoint);
      if (injectElement) {
        injectElement.parentNode.insertBefore(
          button,
          injectElement.nextSibling,
        );
      }
      return;
    }

    const injectElement = element.querySelector(field.injectPoint);
    if (injectElement) {
      injectElement.parentNode.insertBefore(button, injectElement.nextSibling);
    }
  });
}

function injectPersonaButton() {
  if (!ensureSettings().enablePersonaFields) {
    return;
  }

  const textarea = PersonaUtil.getTextarea();
  if (
    !textarea ||
    document.querySelector(".adp_persona_alt_descriptions_button")
  ) {
    return;
  }

  const button = createButton(personaFieldConfig);
  button.classList.add("adp_persona_alt_descriptions_button");

  const controls =
    textarea.closest(".flex-container")?.querySelector(".editor_maximize") ||
    textarea.parentElement?.querySelector(".editor_maximize") ||
    textarea;

  if (controls === textarea) {
    textarea.parentElement?.insertBefore(button, textarea);
  } else {
    controls.parentNode.insertBefore(button, controls.nextSibling);
  }
}

function injectButtons() {
  characterFieldConfigs.forEach(injectCharacterButton);
  injectPersonaButton();
}

function addSettingsUi() {
  const settingsContainer =
    document.getElementById("extensions_settings") ||
    document.getElementById("extensions_settings2");
  if (!settingsContainer || document.getElementById("adp_settings")) {
    return;
  }

  const settings = ensureSettings();
  const block = document.createElement("div");
  block.id = "adp_settings";
  block.className = "adp_settings_block";
  block.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Alternate Descriptions Plus</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label><input type="checkbox" id="adp_enable_character" ${settings.enableCharacterFields ? "checked" : ""}> Enable character field alternates</label>
                <label><input type="checkbox" id="adp_enable_persona" ${settings.enablePersonaFields ? "checked" : ""}> Enable persona description alternates</label>
                <label><input type="checkbox" id="adp_auto_save_first" ${settings.autoSaveFirstVersion ? "checked" : ""}> Auto-save first version on first open</label>
                <label><input type="checkbox" id="adp_warn_unsaved" ${settings.warnUnsavedChanges ? "checked" : ""}> Warn before overwriting unsaved changes</label>
                <label><input type="checkbox" id="adp_show_tokens" ${settings.showTokenCounts ? "checked" : ""}> Show token counts</label>
            </div>
        </div>
    `;

  settingsContainer.appendChild(block);

  const bindCheckbox = (id, key) => {
    block.querySelector(id)?.addEventListener("change", (event) => {
      settings[key] = event.target.checked;
      saveSettingsDebounced();
      injectButtons();
    });
  };

  bindCheckbox("#adp_enable_character", "enableCharacterFields");
  bindCheckbox("#adp_enable_persona", "enablePersonaFields");
  bindCheckbox("#adp_auto_save_first", "autoSaveFirstVersion");
  bindCheckbox("#adp_warn_unsaved", "warnUnsavedChanges");
  bindCheckbox("#adp_show_tokens", "showTokenCounts");
}

function fieldEnumProvider() {
  return characterFieldConfigs
    .filter(
      (field) => ensureSettings().enabledCharacterFieldKeys[field.fieldKey],
    )
    .map(
      (field) =>
        new SlashCommandEnumValue(
          field.field,
          field.buttonName,
          enumTypes.name,
        ),
    );
}

function fieldNameEnumProvider(executor) {
  const fieldValue = executor.namedArgumentList.find(
    (argument) => argument.name === "field",
  )?.value;
  const fieldConfig = characterFieldConfigs.find(
    (field) => field.field === fieldValue || field.fieldKey === fieldValue,
  );
  if (!fieldConfig) {
    return [];
  }

  return getFieldData(fieldConfig).map(
    (entry) =>
      new SlashCommandEnumValue(
        entry.title,
        entry.content.substring(0, 50) +
          (entry.content.length > 50 ? "..." : ""),
        enumTypes.name,
      ),
  );
}

function personaNameEnumProvider() {
  return getFieldData(personaFieldConfig).map(
    (entry) =>
      new SlashCommandEnumValue(
        entry.title,
        entry.content.substring(0, 50) +
          (entry.content.length > 50 ? "..." : ""),
        enumTypes.name,
      ),
  );
}

function altFieldCallback(namedArguments) {
  const { field, name } = namedArguments;
  const fieldConfig = characterFieldConfigs.find(
    (config) => config.field === field || config.fieldKey === field,
  );
  if (!fieldConfig) {
    return `Error: Unknown field "${field}". Available fields: ${characterFieldConfigs.map((config) => config.field).join(", ")}`;
  }

  return switchToAlternate(fieldConfig, name);
}

function altPersonaCallback(namedArguments) {
  const { name } = namedArguments;
  return switchToAlternate(personaFieldConfig, name);
}

function switchToAlternate(field, name) {
  try {
    const data = getFieldData(field);
    if (!data.length) {
      return `Error: No alternate entries found for ${field.scope} ${field.singularName}.`;
    }

    let alternate;
    if (name && String(name).trim()) {
      alternate = data.find((entry) => entry.title === name);
      if (!alternate) {
        return `Error: No alternate named "${name}" found. Available: ${data.map((entry) => entry.title).join(", ")}`;
      }
    } else {
      alternate = data[Math.floor(Math.random() * data.length)];
    }

    if (!setCurrentField(field, alternate.content)) {
      return `Error: Could not find active ${field.singularName} field.`;
    }

    return alternate.content;
  } catch (error) {
    console.error(`${LOG_PREFIX} slash command failed`, error);
    return `Error: ${error.message}`;
  }
}

function registerSlashCommands() {
  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: "altfield",
      callback: altFieldCallback,
      helpString:
        'Switch to an alternate character field entry. Example: /altfield field=description name="Description #1". Omit name to select a random alternate.',
      namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
          name: "field",
          description: "Character field to switch",
          typeList: [ARGUMENT_TYPE.STRING],
          isRequired: true,
          enumProvider: fieldEnumProvider,
          forceEnum: false,
        }),
        SlashCommandNamedArgument.fromProps({
          name: "name",
          description: "Alternate title. Omit for random.",
          typeList: [ARGUMENT_TYPE.STRING],
          enumProvider: fieldNameEnumProvider,
        }),
      ],
      returns: ARGUMENT_TYPE.STRING,
    }),
  );

  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: "altpersona",
      callback: altPersonaCallback,
      helpString:
        'Switch to an alternate persona description. Example: /altpersona name="Formal". Omit name to select a random alternate.',
      namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
          name: "name",
          description: "Persona alternate title. Omit for random.",
          typeList: [ARGUMENT_TYPE.STRING],
          enumProvider: personaNameEnumProvider,
        }),
      ],
      returns: ARGUMENT_TYPE.STRING,
    }),
  );
}

jQuery(() => {
  ensureSettings();
  injectButtons();
  addSettingsUi();
  registerSlashCommands();

  const reinject = () => setTimeout(injectButtons, 500);
  eventSource.on?.(event_types.CHAT_CHANGED, reinject);
  eventSource.on?.(event_types.CHARACTER_EDITED, reinject);
  eventSource.on?.(event_types.PERSONA_CHANGED, reinject);
  eventSource.on?.(event_types.PERSONA_UPDATED, reinject);

  const observer = new MutationObserver(() => injectPersonaButton());
  observer.observe(document.body, { childList: true, subtree: true });

  console.log(`${LOG_PREFIX} loaded`);
});
