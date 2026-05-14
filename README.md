# SillyTavern Alternate Descriptions Plus

_A fork / functional extension of **SillyTavern-AlternateDescriptions**_

## Overview

A SillyTavern extension that allows you to save and manage multiple versions of supported text fields.

It follows the original Alternate Descriptions workflow and extends it with support for **user persona description** alternates.

**Supported Character Fields**: Description, Personality, Scenario, Example Dialogue, Main Prompt, Post-History Instructions  
**Supported Persona Fields**: Persona Description

## Features

- **Character + Persona support** - Manage alternates for both card fields and persona description
- **Auto-save** - Automatically saves current field content on first use (optional)
- **Visual indicators** - Shows which alternate is currently active and warns before switching with unsaved changes
- **Token counting** - Shows token count for each alternate
- **Duplicate + quick save** - Duplicate an entry or save current field content in one click
- **Slash command support** - Switch alternates via slash commands
- **Compatibility-first** - Character field storage stays compatible with the original Alternate Descriptions format

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

## Important Notes

- **Manual saving in editor still applies**: switching alternates changes the current field content in the UI
- **Warning system**: confirmation dialogs help prevent accidental overwrite of unsaved text
- **Overwrite behavior**: using an alternate replaces current content in that field

## Credits

- Fork / extension of: `nbrown725/SillyTavern-AlternateDescriptions`
- Original project: https://github.com/nbrown725/SillyTavern-AlternateDescriptions
