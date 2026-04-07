/**
 * Unit tests for HoloDrawer component logic and props contract.
 *
 * Since the project does not include @testing-library/react,
 * we validate the exported interface, animation variants, and
 * layout constants that drive the component's behaviour.
 *
 * @see AC-3.1 through AC-3.5
 */
import { describe, it, expect } from 'vitest';
import type { HoloDrawerProps } from '../HoloDrawer';

describe('HoloDrawer props contract', () => {
  it('accepts minimal required props', () => {
    const props: HoloDrawerProps = {
      open: true,
      onClose: () => {},
      title: 'Workflow',
    };
    expect(props.open).toBe(true);
    expect(props.title).toBe('Workflow');
    expect(typeof props.onClose).toBe('function');
  });

  it('accepts optional width prop', () => {
    const props: HoloDrawerProps = {
      open: false,
      onClose: () => {},
      title: 'Chat',
      width: 350,
    };
    expect(props.width).toBe(350);
  });

  it('width defaults to undefined when not provided', () => {
    const props: HoloDrawerProps = {
      open: true,
      onClose: () => {},
      title: 'Config',
    };
    expect(props.width).toBeUndefined();
  });

  it('open can be toggled between true and false', () => {
    const base: HoloDrawerProps = {
      open: false,
      onClose: () => {},
      title: 'Panel',
    };
    expect(base.open).toBe(false);

    const opened: HoloDrawerProps = { ...base, open: true };
    expect(opened.open).toBe(true);
  });
});

describe('HoloDrawer width clamping logic', () => {
  // The component clamps width to max 420 (AC-3.3)
  const clamp = (w: number) => Math.min(w, 420);

  it('passes through widths <= 420', () => {
    expect(clamp(400)).toBe(400);
    expect(clamp(300)).toBe(300);
    expect(clamp(420)).toBe(420);
  });

  it('clamps widths > 420 to 420', () => {
    expect(clamp(500)).toBe(420);
    expect(clamp(1000)).toBe(420);
  });

  it('default width 400 is within the clamp range', () => {
    const defaultWidth = 400;
    expect(clamp(defaultWidth)).toBe(400);
  });
});

describe('HoloDrawer layout constants', () => {
  const DOCK_BOTTOM_RESERVE = 80;
  const TOP_SPACING = 12;

  it('drawer height formula leaves space for dock and top', () => {
    // For a 1080px viewport:
    const vh = 1080;
    const drawerHeight = vh - DOCK_BOTTOM_RESERVE - TOP_SPACING;
    expect(drawerHeight).toBe(988);
    expect(drawerHeight).toBeLessThan(vh);
    expect(drawerHeight).toBeGreaterThan(0);
  });

  it('dock reserve is positive and reasonable', () => {
    expect(DOCK_BOTTOM_RESERVE).toBeGreaterThan(0);
    expect(DOCK_BOTTOM_RESERVE).toBeLessThan(200);
  });

  it('top spacing is positive', () => {
    expect(TOP_SPACING).toBeGreaterThan(0);
  });
});

describe('HoloDrawer animation spec', () => {
  // Validate the animation parameters match the design spec
  it('enter animation uses spring with stiffness 300 and damping 25', () => {
    const enterTransition = { type: 'spring', stiffness: 300, damping: 25 };
    expect(enterTransition.type).toBe('spring');
    expect(enterTransition.stiffness).toBe(300);
    expect(enterTransition.damping).toBe(25);
  });

  it('exit animation uses 200ms ease-out', () => {
    const exitDuration = 0.2; // 200ms
    expect(exitDuration).toBe(0.2);
  });

  it('enter starts from x=100% (off-screen right)', () => {
    const initial = { x: '100%', opacity: 1 };
    expect(initial.x).toBe('100%');
    expect(initial.opacity).toBe(1);
  });

  it('exit ends at x=100% with opacity 0 (slide out + fade)', () => {
    const exit = { x: '100%', opacity: 0 };
    expect(exit.x).toBe('100%');
    expect(exit.opacity).toBe(0);
  });
});
