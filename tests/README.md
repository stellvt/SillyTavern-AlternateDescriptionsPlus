# Browser verification

Run the browser checks against a separate SillyTavern instance with disposable data.
The checks use the real extension, persona module, event emitter, and settings API.

Failure cases to cover:

- Linking fails to create a native persona connection or selects the wrong alternate.
- Switching characters with the same persona retains the previous alternate.
- A character without an alternate inherits a linked character's text.
- Reloading loses the association or overwrites the persona's default description.
- A chat-locked persona is overridden by another persona's alternate.
- Native disconnection leaves an alternate active.
- Replacing, duplicating, or deleting an alternate leaves conflicting links.
- Disabling persona alternates leaves automatic selection active.
- Closing the editor or changing persona loses edits or saves them to another persona.
- Missing character selection, group chats, or malformed entry collections break the editor.
- Buttons overflow a narrow viewport.

The test run writes a JSON result, browser trace, and screenshots to `test-results/`.
