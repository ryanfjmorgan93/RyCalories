import { expect, test } from '@playwright/test';
import { messageBody, text, toolUse, type FakeReply } from '../src/test/fakeClaude';
import { fresh, readRawIron } from './fresh';

/**
 * The coach adds exercises the owner has not got yet, from the app's own library, on the built app:
 * one bundled diagram and one catalogue entry, whose data is a lazy chunk the built app has to fetch.
 * The Anthropic API is never reached: its replies are canned here, and what the tools did is read
 * back from IndexedDB and from the tool results the app sends back to the model.
 */

const KEY = 'sk-ant-test-0123456789abcdefGHIJKLmnop';

test('the coach adds a library diagram and a catalogue exercise to a routine, and they become the owner\'s', async ({ page }) => {
  const toolResults: string[] = [];
  await page.addInitScript((key) => localStorage.setItem('iron.claudeKey', key), KEY);
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = request.postDataJSON() as Record<string, any>;
    let reply: FakeReply;
    if (String(body.model).includes('haiku')) reply = { content: [text('')] };
    else if ((body.output_config as { format?: unknown } | undefined)?.format) reply = { content: [text('{"review":"A steady week."}')] };
    else {
      const last = (body.messages as { content: unknown }[]).at(-1)!;
      const results = Array.isArray(last.content) ? (last.content as { type: string; content?: unknown }[]).filter((b) => b.type === 'tool_result') : [];
      if (results.length > 0) {
        toolResults.push(...results.map((r) => JSON.stringify(r.content)));
        reply = { content: [text('Added both to Upper (Push).')] };
      } else {
        reply = {
          content: [
            toolUse('toolu_1', 'edit_routine', { routine: 'Upper (Push)', exercise: 'Chest-Supported Row', change: 'add' }),
            toolUse('toolu_2', 'edit_routine', { routine: 'Upper (Push)', exercise: 'Dumbbell Incline Row', change: 'add' }),
          ],
          stop_reason: 'tool_use',
        };
      }
    }
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(messageBody(reply, String(body.model))) });
  });
  await fresh(page);
  const before = (await readRawIron(page)).tables.exercises.length;

  await page.getByTestId('coach-fab').click();
  await page.getByTestId('coach-input').fill('add a chest supported row and an incline dumbbell row to push day');
  await page.getByTestId('coach-send').click();
  await expect(page.getByText('Added both to Upper (Push).')).toBeVisible();

  expect(toolResults).toHaveLength(2);
  expect(toolResults[0]).toContain('Added Chest Supported Row to Upper (Push).');
  expect(toolResults[1]).toContain('Added Dumbbell Incline Row to Upper (Push).');
  for (const r of toolResults) expect(r).toContain('came from the library');

  const { tables } = await readRawIron(page);
  const made = (tables.exercises as { id: string; name: string; demo?: string }[]).filter((e) => ['Chest Supported Row', 'Dumbbell Incline Row'].includes(e.name));
  expect(made.map((e) => [e.name, e.demo]).sort()).toEqual([
    ['Chest Supported Row', 'chest-supported-row'],
    ['Dumbbell Incline Row', 'cat:dumbbell-incline-row'],
  ]);
  expect(tables.exercises.length).toBe(before + 2);
  const push = (tables.routines as { id: string; name: string }[]).find((r) => r.name === 'Upper (Push)')!;
  const inPush = new Set((tables.routineExercises as { routineId: string; exerciseId: string }[]).filter((rx) => rx.routineId === push.id).map((rx) => rx.exerciseId));
  for (const e of made) expect(inPush.has(e.id)).toBe(true);
});
