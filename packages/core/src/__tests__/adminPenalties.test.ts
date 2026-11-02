import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePenaltyExpirationIso,
  checkAutoModerationViolation,
  getCustomRolesSync,
  getUserCustomRolesSync,
} from '../admin';
import {
  FREE_TIER_AI_MODELS,
  DEVELOPER_TOOL_DECLARATIONS,
  getLocalDeveloperAiConfig,
  runDeveloperAiAssistantTurn,
} from '../aiAssistant';

describe('computePenaltyExpirationIso (ban & mute duration calculator)', () => {
  it('returns null for permanent bans', () => {
    const res = computePenaltyExpirationIso({ permanent: true, durationValue: 10, durationUnit: 'days' });
    assert.equal(res, null);
  });

  it('computes exact untilDate ISO string', () => {
    const target = '2030-05-15T14:30:00.000Z';
    const res = computePenaltyExpirationIso({ untilDate: target });
    assert.equal(res, new Date(target).toISOString());
  });

  it('supports seconds, minutes, hours, days, months, and years', () => {
    const before = Date.now();
    const secIso = computePenaltyExpirationIso({ durationValue: 30, durationUnit: 'seconds' });
    assert.ok(secIso);
    const secDiff = new Date(secIso!).getTime() - before;
    assert.ok(secDiff >= 29_000 && secDiff <= 32_000);

    const minIso = computePenaltyExpirationIso({ durationValue: 5, durationUnit: 'minutes' });
    assert.ok(minIso);
    const minDiff = new Date(minIso!).getTime() - before;
    assert.ok(minDiff >= 299_000 && minDiff <= 302_000);

    const hrIso = computePenaltyExpirationIso({ durationValue: 2, durationUnit: 'hours' });
    assert.ok(hrIso);
    const hrDiff = new Date(hrIso!).getTime() - before;
    assert.ok(hrDiff >= 7_199_000 && hrDiff <= 7_202_000);

    const dayIso = computePenaltyExpirationIso({ durationValue: 3, durationUnit: 'days' });
    assert.ok(dayIso);
    const dayDiff = new Date(dayIso!).getTime() - before;
    assert.ok(dayDiff >= 3 * 86_400_000 - 2000 && dayDiff <= 3 * 86_400_000 + 2000);

    const monthIso = computePenaltyExpirationIso({ durationValue: 2, durationUnit: 'months' });
    assert.ok(monthIso);
    assert.ok(new Date(monthIso!).getTime() > before + 50 * 86_400_000);

    const yearIso = computePenaltyExpirationIso({ durationValue: 1, durationUnit: 'years' });
    assert.ok(yearIso);
    assert.ok(new Date(yearIso!).getTime() > before + 360 * 86_400_000);
  });
});

describe('checkAutoModerationViolation', () => {
  it('flags heavy phrases for freeze and light spam for mute', () => {
    const severe = checkAutoModerationViolation('Купите наркотики дешево');
    assert.equal(severe.violated, true);
    assert.equal(severe.severity, 'heavy');

    const mild = checkAutoModerationViolation('Быстрый заработок без вложений прямо сейчас');
    assert.equal(mild.violated, true);
    assert.equal(mild.severity, 'light');

    const clean = checkAutoModerationViolation('Привет! Как дела в Pixset Studio?');
    assert.equal(clean.violated, false);
    assert.equal(clean.severity, undefined);
  });
});

describe('Custom Roles & Developer AI Assistant guards', () => {
  it('provides all requested Gemini models, Antigravity agent, and 16 tools', () => {
    const modelIds = FREE_TIER_AI_MODELS.map((m) => m.id);
    assert.ok(modelIds.includes('gemini-2.5-flash'));
    assert.ok(modelIds.includes('gemini-2.5-flash-lite'));
    assert.ok(modelIds.includes('gemini-3-flash-preview'));
    assert.ok(modelIds.includes('gemini-3.5-flash-lite'));
    assert.ok(modelIds.includes('gemini-3.6-flash'));
    assert.ok(modelIds.includes('gemini-3.8-flash'));
    assert.ok(modelIds.includes('gemini-3.1-flash-lite'));
    assert.ok(modelIds.includes('antigravity-preview-09-2026'));

    const antigravityModel = FREE_TIER_AI_MODELS.find((m) => m.id === 'antigravity-preview-09-2026');
    assert.equal(antigravityModel?.isAgent, true);

    assert.equal(DEVELOPER_TOOL_DECLARATIONS.length, 16);
    const cfg = getLocalDeveloperAiConfig();
    assert.equal(cfg.model, 'gemini-2.5-flash');
  });

  it('rejects non-developer access to runDeveloperAiAssistantTurn', async () => {
    const fakeAdmin: any = {
      id: '00000000-0000-0000-0000-000000000001',
      username: 'admin_user',
      display_name: 'Admin',
      role: 'admin',
    };
    await assert.rejects(
      async () => {
        await runDeveloperAiAssistantTurn({
          prompt: 'Покажи статистику',
          history: [],
          actingProfile: fakeAdmin,
        });
      },
      /developer/i
    );
  });

  it('returns empty array for getCustomRolesSync when all roles are deleted', () => {
    assert.deepEqual(getCustomRolesSync(), []);
    assert.deepEqual(getUserCustomRolesSync('non-existent'), []);
  });
});


