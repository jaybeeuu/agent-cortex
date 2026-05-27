import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ralphPlanAgentPath = resolve(process.cwd(), '../../..', 'agents/ralph-plan.agent.md');
const ralphPlanAgentContent = readFileSync(ralphPlanAgentPath, 'utf8');

describe('ralph-plan planning gates', () => {
  it('requires creating a HITL planning gate for each new feature/task bead and blocking on it', () => {
    assert.match(
      ralphPlanAgentContent,
      /for each new (feature|task) bead[\s\S]*create[\s\S]*HITL planning gate/i
    );
    assert.match(
      ralphPlanAgentContent,
      /bd dep add\s+<[^>]+>\s+<[^>]+>[\s\S]*(depends on|blocks)/i
    );
  });

  it('requires per-feature confirmation before closing planning gates', () => {
    assert.match(
      ralphPlanAgentContent,
      /Only close a gate after the user explicitly confirms that exact feature\/task/i
    );
    assert.match(ralphPlanAgentContent, /Do not close planning gates in bulk/i);
  });

  it('requires cold-start-ready planning gate descriptions', () => {
    assert.match(ralphPlanAgentContent, /cold-start-ready/i);
    assert.match(ralphPlanAgentContent, /decisions already made/i);
    assert.match(ralphPlanAgentContent, /open questions\/risks/i);
    assert.match(ralphPlanAgentContent, /references/i);
  });

  it('requires gate status reporting and explicit remaining-open warning', () => {
    assert.match(
      ralphPlanAgentContent,
      /planning gate status[\s\S]*✅[\s\S]*⏳/i
    );
    assert.match(
      ralphPlanAgentContent,
      /If any planning gates remain open[\s\S]*explicit warning[\s\S]*blocked/i
    );
  });
});
