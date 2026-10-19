# SillyTavern Alternate Descriptions Plus

## Overview

Save character field variants and persona descriptions, then select the text to use.

**Supported Character Fields**: Description, Personality, Scenario, Example Dialogue, Main Prompt, Post-History Instructions  
**Supported Persona Fields**: Persona Description

## Features

- **Character + Persona support** - Manage alternates for both card fields and persona description
- **Auto-save** - Automatically saves current field content on first use (optional)
- **Visual indicators** - Shows which alternate is currently active and warns before switching with unsaved changes
- **Token counting** - Shows token count for each alternate
- **Duplicate + quick save** - Duplicate an entry or save current field content in one click
- **Slash command support** - Switch alternates via slash commands
- **Character links** - Choose a persona description for each character through native Persona Connections

## Installation

- Open SillyTavern
- Go to **Extensions** → **Install extension**
- Install from your repository URL (or place it in your local `third-party` folder)
- Reload SillyTavern

The extension adds `Alt. ...` buttons near supported fields.

## Usage

### Basic Usage

- **Open manager**: Click `Alt. ...` near a supported field
- **Add alternates**: Use **Add New**
- **Save current content**: Use **Save Current**
- **Switch alternates**: Use **Use**
- **Duplicate entries**: Use **Duplicate**
- **Delete entries**: Use **Delete**
- **Edit entries**: Change title/content directly in the popup

### Link a persona description to a character

1. Open a character chat and select a persona.
2. Open **Alt. Persona Descriptions**.
3. Click **Link to Character** beside the description to use.

The button creates a native Persona Connection and applies that alternate whenever the character opens with this persona selected. SillyTavern controls persona selection, including chat locks and multiple connected personas. Each persona can have one linked alternate per character.

Automatic selection preserves the persona's default description for characters without a linked alternate. **Use** and `/altpersona` save the chosen text as the persona's default description. Editing the main persona description also saves the default; edit an alternate in this popup to change its saved text.

**Unlink from Character** removes the alternate assignment and restores the default description. The native Persona Connection remains available in **Connections**. Removing that native connection also stops automatic alternate selection. Duplicates have no links; deleting an alternate removes its assignments.

Links require an individual character chat. Disabling persona alternates restores the default description and pauses automatic selection.

### Slash Command Usage

#### Character fields

```text
/altfield field=<field_name> name=<alternate_name>
```

- `field` - Character field key (required)
- `name` - Alternate title (optional)

Examples:

```text
/altfield field=description name="Description #1"
/altfield field=scenario
```

If `name` is omitted, a random alternate is selected.

#### Persona description

```text
/altpersona name=<alternate_name>
```

Example:

```text
/altpersona name="Persona Description #1"
/altpersona
```

If `name` is omitted, a random alternate is selected.

## Browser checks

From this extension directory inside SillyTavern, run `npm ci`, `npx playwright install chromium`, and `npm run test:e2e`. The runner starts a separate local server on port 8018 with disposable personas, characters, and settings. Set `ADP_TEST_PORT` to choose another port. Results, screenshots, and a Playwright trace are saved under `test-results/`.

The extension uses the persona APIs in SillyTavern 1.18.0.

## Credits

- Fork / extension of: `nbrown725/SillyTavern-AlternateDescriptions`
- Original project: https://github.com/nbrown725/SillyTavern-AlternateDescriptions
