import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAgents = vi.fn();

vi.mock('../db/index.js', () => ({
  default: {
    getAgents,
  },
}));

describe('phase1 registry validation', () => {
  beforeEach(() => {
    getAgents.mockReset();
    vi.resetModules();
  });

  it('loads agents and preserves CEO-manager-worker relationships', async () => {
    getAgents.mockReturnValue([
      {
        id: 'ceo',
        name: 'CEO Gateway',
        department: 'meta',
        role: 'ceo',
        manager_id: null,
        model: 'gpt-4.1-mini',
        soul_md: '',
      },
      {
        id: 'pixel',
        name: 'Pixel',
        department: 'game',
        role: 'manager',
        manager_id: 'ceo',
        model: 'gpt-4.1-mini',
        soul_md: '',
      },
      {
        id: 'blaze',
        name: 'Blaze',
        department: 'game',
        role: 'worker',
        manager_id: 'pixel',
        model: 'gpt-4.1-mini',
        soul_md: '',
      },
    ]);

    const { registry } = await import('../core/registry.js');
    registry.init();

    expect(registry.getCEO()?.config.id).toBe('ceo');
    expect(registry.getManagerByDepartment('game')?.config.id).toBe('pixel');
    expect(registry.getWorkersByManager('pixel').map((agent) => agent.config.id)).toEqual(['blaze']);
  });
});
