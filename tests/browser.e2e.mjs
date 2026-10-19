import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(extension, '../../../../..');
const output = path.join(extension, 'test-results', new Date().toISOString().replace(/[:.]/g, '-'));
const profile = path.join(output, 'data', 'default-user');
await fs.mkdir(path.join(profile, 'User Avatars'), { recursive: true });
const settings = JSON.parse(await fs.readFile(path.join(root, 'default/content/settings.json'), 'utf8'));
settings.firstRun = false;
settings.main_api = 'openai';
settings.power_user.personas = { 'user-default.png': 'Test Persona', 'second.png': 'Second Persona' };
settings.power_user.persona_descriptions = Object.fromEntries(Object.entries(settings.power_user.personas).map(([key, name]) => [key, {
    description: `${name} default`, position: 0, depth: 2, role: 0, lorebook: '', connections: [], title: '',
}]));
settings.power_user.persona_description = 'Test Persona default';
settings.power_user.persona_show_notifications = false;
settings.power_user.persona_auto_lock = false;
settings.power_user.persona_allow_multi_connections = true;
settings.extension_settings.disabledExtensions = (await fs.readdir(path.dirname(extension)))
    .filter(name => name !== path.basename(extension)).map(name => `third-party/${name}`);
await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify(settings));
for (const name of ['user-default.png', 'second.png']) {
    await fs.copyFile(path.join(root, 'default/content/user-default.png'), path.join(profile, 'User Avatars', name));
}
const config = path.join(output, 'config.yaml');
const configText = await fs.readFile(path.join(root, 'default/config.yaml'), 'utf8');
await fs.writeFile(config, configText.replace('autoUpdate: true', 'autoUpdate: false').replace('enableDownloadableTokenizers: true', 'enableDownloadableTokenizers: false'));
const port = process.env.ADP_TEST_PORT || '8018';
// Refuse an occupied port before starting the disposable instance.
const probe = createServer();
probe.listen(Number(port), '127.0.0.1');
await once(probe, 'listening');
await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, ['server.js', '--configPath', config, '--dataRoot', path.join(output, 'data'), '--port', port, '--listen', 'false', '--browserLaunchEnabled', 'false'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', value => { serverLog += value; void fs.appendFile(path.join(output, 'server-live.log'), value); });
server.stderr.on('data', value => { serverLog += value; void fs.appendFile(path.join(output, 'server-live.log'), value); });
const baseURL = `http://127.0.0.1:${port}`;
let browser;
const checks = [];
const errors = [];
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); console.log(`PASS ${name}`); };
try {
    for (let i = 0; i < 240; i++) {
        if (server.exitCode !== null) throw new Error(`Server exited: ${serverLog.slice(-3000)}`);
        try { if ((await fetch(baseURL, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* Wait for HTTP listener. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const ready = async () => {
        await page.waitForFunction(() => window.SillyTavern && document.querySelector('#adp_settings') && !document.querySelector('#preloader'));
        await page.evaluate(async () => {
            window.adpTest = {
                script: await import('/script.js'),
                personas: await import('/scripts/personas.js'),
                power: (await import('/scripts/power-user.js')).power_user,
                settings: (await import('/scripts/extensions.js')).extension_settings,
            };
        });
        await page.waitForFunction(() => adpTest.script.eventSource.autoFireLastArgs.has(adpTest.script.event_types.APP_READY));
    };
    await page.goto(baseURL);
    await ready();
    await page.evaluate(async () => {
        for (const name of ['ADP Alpha', 'ADP Beta', 'ADP Unlinked']) {
            const body = new FormData();
            body.set('ch_name', name);
            body.set('description', name);
            body.set('first_mes', 'Test greeting.');
            const headers = adpTest.script.getRequestHeaders();
            delete headers['Content-Type'];
            const result = await fetch('/api/characters/create', { method: 'POST', headers, body });
            if (!result.ok) throw new Error(`Create failed: ${result.status}`);
        }
        await adpTest.script.getCharacters();
    });
    const select = async name => {
        await page.evaluate(async name => {
            const index = adpTest.script.characters.findIndex(character => character.name === name);
            await adpTest.script.selectCharacterById(index);
        }, name);
    };
    const active = () => page.evaluate(() => adpTest.power.persona_description);
    const open = async () => {
        if (!await page.locator('#persona_description').isVisible()) await page.locator('#persona-management-button .drawer-icon').click();
        await page.locator('.adp_persona_alt_descriptions_button').click();
        await page.locator('.adp_popup').waitFor();
    };
    const close = async () => {
        await page.locator('#dialogue_popup_ok').click();
        await page.locator('.adp_popup').waitFor({ state: 'detached' });
    };
    const row = title => page.locator('.adp_field_item').filter({ has: page.locator(`input.adp_field_title[value="${title}"]`) });
    await select('ADP Alpha');
    await open();
    await page.locator('.adp_add_btn').click();
    await page.locator('.adp_field_title').last().fill('Formal');
    await page.locator('.adp_field_textarea').last().fill('Formal linked description');
    await page.locator('.adp_link_btn').last().click();
    check('Link applies alternate', await active(), 'Formal linked description');
    check('Native connection and default preserved', await page.evaluate(() => {
        const descriptor = adpTest.power.persona_descriptions[adpTest.personas.user_avatar];
        return [descriptor.connections.some(c => c.id === adpTest.personas.getCurrentConnectionObj().id), descriptor.description];
    }), [true, 'Test Persona default']);
    await page.screenshot({ path: path.join(output, 'linked-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check('Narrow popup actions fit', await page.locator('.adp_popup').evaluate(element => element.scrollWidth <= element.clientWidth + 2), true);
    await page.screenshot({ path: path.join(output, 'linked-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await close();
    await select('ADP Unlinked');
    check('Unlinked character uses default', await active(), 'Test Persona default');
    await select('ADP Beta');
    await open();
    await page.locator('.adp_add_btn').click();
    await page.locator('.adp_field_title').last().fill('Casual');
    await page.locator('.adp_field_textarea').last().fill('Casual linked description');
    await page.locator('.adp_link_btn').last().click();
    await close();
    await select('ADP Alpha');
    check('Same persona switches alternate between characters', await active(), 'Formal linked description');
    let persistedLinks = 0;
    for (let i = 0; i < 30; i++) {
        const saved = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
        persistedLinks = Object.keys(saved.extension_settings.alternate_descriptions_plus?.personas?.['user-default.png']?.characterLinks || {}).length;
        if (persistedLinks === 2) break;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    check('Links are written to disk', persistedLinks, 2);
    await page.reload();
    await ready();
    await select('ADP Beta');
    check('Persisted link survives reload', await active(), 'Casual linked description');
    await page.evaluate(async () => {
        adpTest.script.chat_metadata.persona = 'second.png';
        await adpTest.personas.setUserAvatar('second.png');
        await adpTest.script.saveMetadata();
    });
    await select('ADP Alpha');
    await select('ADP Beta');
    check('Other chat-locked persona keeps its description', await active(), 'Second Persona default');
    await page.evaluate(async () => {
        delete adpTest.script.chat_metadata.persona;
        await adpTest.script.saveMetadata();
        await adpTest.personas.setUserAvatar('user-default.png');
    });
    check('Selecting connected persona resolves its alternate', await active(), 'Casual linked description');
    await open();
    await row('Casual').locator('.adp_duplicate_btn').click();
    check('Duplicate does not inherit link', await row('Casual Copy').locator('.adp_link_btn').getAttribute('aria-pressed'), 'false');
    await row('Formal').locator('.adp_link_btn').click();
    check('Replacing link selects one alternate', await active(), 'Formal linked description');
    check('Only one row linked', await page.locator('.adp_link_btn[aria-pressed="true"]').count(), 1);
    await row('Formal').locator('.adp_link_btn').click();
    check('Unlink restores default', await active(), 'Test Persona default');
    await row('Casual').locator('.adp_link_btn').click();
    await row('Casual').locator('.adp_delete_btn').click();
    check('Deleting linked entry restores default', await active(), 'Test Persona default');
    await row('Formal').locator('.adp_link_btn').click();
    await close();
    await page.evaluate(() => adpTest.personas.setPersonaLockState(false, 'character'));
    await page.waitForFunction(() => adpTest.power.persona_description === 'Test Persona default');
    check('Native disconnect restores default', await active(), 'Test Persona default');
    await open();
    await row('Formal').locator('.adp_link_btn').click();
    await row('Formal').locator('.adp_field_textarea').fill('Edited just before closing');
    await close();
    await page.evaluate(() => adpTest.personas.setUserAvatar('second.png'));
    await page.waitForTimeout(700);
    check('Edits stay with the original persona', await page.evaluate(() => {
        const personas = adpTest.settings.alternate_descriptions_plus.personas;
        return [personas['user-default.png'].alt_descriptions.find(e => e.title === 'Formal').content, personas['second.png']?.alt_descriptions?.length || 0];
    }), ['Edited just before closing', 0]);
    await page.evaluate(() => adpTest.personas.setUserAvatar('user-default.png'));
    await page.evaluate(() => {
        const checkbox = document.querySelector('#adp_enable_persona');
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    check('Disable restores default and removes button', [await active(), await page.locator('.adp_persona_alt_descriptions_button').count()], ['Test Persona default', 0]);
    await select('ADP Alpha');
    check('Disabled links do not apply on chat change', await active(), 'Test Persona default');
    await page.evaluate(() => {
        const checkbox = document.querySelector('#adp_enable_persona');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    check('Re-enable applies saved alternate', await active(), 'Edited just before closing');
    await page.evaluate(async () => {
        const oldAvatar = adpTest.personas.getCurrentConnectionObj().id;
        const response = await fetch('/api/characters/rename', {
            method: 'POST', headers: adpTest.script.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: oldAvatar, new_name: 'ADP Renamed' }),
        });
        if (!response.ok) throw new Error(`Rename failed: ${response.status}`);
        const result = await response.json();
        await adpTest.script.eventSource.emit(adpTest.script.event_types.CHARACTER_RENAMED, oldAvatar, result.avatar);
        adpTest.script.setCharacterId(undefined);
        await adpTest.script.getCharacters();
    });
    await select('ADP Renamed');
    check('Renamed character retains native and alternate links', await active(), 'Edited just before closing');
    await page.evaluate(() => adpTest.script.setCharacterId(undefined));
    await open();
    check('Link is disabled without a character', await page.locator('.adp_link_btn').first().isDisabled(), true);
    await close();
    await page.evaluate(async () => {
        await adpTest.personas.setUserAvatar('second.png');
        adpTest.settings.alternate_descriptions_plus.personas['second.png'] = { alt_descriptions: {} };
    });
    await open();
    check('Malformed entry collection opens safely', await page.locator('.adp_field_item').count(), 1);
    await close();
    await page.evaluate(async () => {
        const response = await fetch('/api/groups/create', {
            method: 'POST', headers: adpTest.script.getRequestHeaders(),
            body: JSON.stringify({ name: 'ADP Group', members: [], chat_id: 'adp-group-test' }),
        });
        if (!response.ok) throw new Error(`Group creation failed: ${response.status}`);
        const group = await response.json();
        const groups = await import('/scripts/group-chats.js');
        await groups.getGroups();
        await groups.openGroupById(group.id);
    });
    await open();
    check('Link is disabled in a group chat', await page.locator('.adp_link_btn').first().isDisabled(), true);
    await close();
    check('No browser exceptions', errors, []);
    await context.tracing.stop({ path: path.join(output, 'trace.zip') });
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2));
    console.log(`Artifacts: ${output}`);
} catch (error) {
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, error: error.stack, errors }, null, 2));
    if (browser) {
        const context = browser.contexts()[0];
        await context.pages()[0]?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        await context.tracing.stop({ path: path.join(output, 'trace.zip') }).catch(() => {});
    }
    throw error;
} finally {
    await browser?.close();
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
    await fs.writeFile(path.join(output, 'server.log'), serverLog);
}
