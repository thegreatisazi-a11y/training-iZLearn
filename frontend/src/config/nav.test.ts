import { describe, expect, it } from 'vitest';
import { NAV, sidebarSections } from './nav';

const paths = (sections: ReturnType<typeof sidebarSections>) => sections.flatMap((section) =>
  section.kind === 'link' ? [section.item.to] : section.items.map((item) => item.to));

describe('sidebar grouping', () => {
  it('shows every accessible module exactly once and keeps My Profile last', () => {
    const permissions = Object.fromEntries(NAV.filter((item) => item.module).map((item) =>
      [item.module!, { read: true, view: true }]));
    const sections = sidebarSections(permissions);
    expect(paths(sections)).toEqual(expect.arrayContaining(NAV.map((item) => item.to)));
    expect(paths(sections)).toHaveLength(NAV.length);
    expect(sections[sections.length - 1]).toMatchObject({ kind: 'link', item: { to: '/profile' } });
    expect(sections.filter((section) => section.kind === 'group').map((section) => section.label))
      .toEqual(['My Documents', 'People & Team', 'Training', 'Communication', 'Administration & Oversight']);
  });

  it('shows one permitted destination directly and hides inaccessible destinations', () => {
    const sections = sidebarSections({ feedback: { read: true } });
    expect(sections.some((section) => section.kind === 'link' && section.item.to === '/feedback')).toBe(true);
    expect(sections.some((section) => section.kind === 'group' && section.id === 'communication')).toBe(false);
    expect(paths(sections)).not.toContain('/reports');
    const visiblePaths = paths(sections);
    expect(visiblePaths[visiblePaths.length - 1]).toBe('/profile');
  });
});
