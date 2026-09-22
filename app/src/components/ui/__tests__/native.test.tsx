/**
 * The six native wrappers (redesign — SPEC "Shell chrome > Platform split";
 * SPEC rules 7, 8, 12, 15) and the dialog helper (`src/test/dialog.ts`).
 *
 * WHAT THIS PROVES. `import { SegmentedPicker } from '../native'` resolves to
 * the `.ios.tsx` file — `app/vitest.config.ts` lists `.ios.tsx` first — so
 * every render below is the `@expo/ui/swift-ui` tree, serialised through the
 * stub: findable by its `expo-ui-*` tags, callbacks invocable under their REAL
 * names (`onSelectionChange`, `onIsOnChange`, `onPress`), modifiers readable
 * as plain descriptors. For each wrapper: the options and the selection are in
 * the tree, the RN-shaped `onChange` fires from the native callback exactly
 * once and never for the current value, the haptic policy is counted (a tick
 * → one `selection`; a destructive confirm → one `impact:Medium`; a toggle,
 * a menu item and an empty state → none), no name in the tree contains
 * `down`, and the `ConfirmDialog` renders no action until presented — then
 * `confirmDialog(tree, 'Delete')` runs the destructive action exactly once.
 *
 * THE ANDROID TWINS are exercised on device (SPEC "Risks"); one describe below
 * imports each `.android` path explicitly and proves it RENDERS the same
 * contract on RN primitives. The rn-stub has neither `Switch` nor `Alert`
 * (nothing in the app used them before this phase), and that file is not this
 * unit's to edit, so this file extends the aliased stub in place through
 * `vi.mock` — a host `rn-switch` and a recording `Alert.alert` — for the
 * Android renders only; the iOS trees never touch either.
 */

import { act, type ReactElement } from 'react';
import { Alert } from 'react-native';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { confirmDialog, dialogPresented } from '../../../test/dialog';
import { __haptics, __resetHaptics } from '../../../test/expo-haptics-stub';
import { darkColors, HIT_TARGET } from '../../../theme';
import { Button } from '../Button';
import {
  ConfirmDialog,
  EmptyState,
  HeaderMenu,
  MenuPicker,
  NativeToggle,
  SegmentedPicker,
} from '../native';
import { ConfirmDialog as ConfirmDialogAndroid } from '../native/ConfirmDialog.android';
import { EmptyState as EmptyStateAndroid } from '../native/EmptyState.android';
import { HeaderMenu as HeaderMenuAndroid } from '../native/HeaderMenu.android';
import { MenuPicker as MenuPickerAndroid } from '../native/MenuPicker.android';
import { NativeToggle as NativeToggleAndroid } from '../native/NativeToggle.android';
import { SegmentedPicker as SegmentedPickerAndroid } from '../native/SegmentedPicker.android';
import { SYMBOLS } from '../Symbol';

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../test/rn-stub')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    /** RN's Switch as a host element, its props forwarded. */
    Switch: (props: Record<string, unknown>) => createElement('rn-switch', props),
    /** RN's Alert as a recorder: a test reads the buttons it was handed. */
    Alert: { alert: vi.fn() },
  };
});

function render(node: ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());

/** Matches a stub's host element by tag. A `string`-typed predicate rather
 *  than `findByType`, whose parameter is React's `ElementType` — DOM tag names
 *  only under strict TS, so a stub's own tag would not type-check. */
const ofTag =
  (tag: string) =>
  (n: ReactTestInstance): boolean =>
    n.type === tag;

const host = (tree: ReactTestRenderer, tag: string): ReactTestInstance =>
  tree.root.find(ofTag(tag));

const hosts = (tree: ReactTestRenderer, tag: string): ReactTestInstance[] =>
  tree.root.findAll(ofTag(tag));

const call = <A,>(node: ReactTestInstance, prop: string, arg?: A): void => {
  act(() => {
    (node.props[prop] as (a?: A) => void)(arg);
  });
};

afterEach(() => {
  __resetHaptics();
  vi.mocked(Alert.alert).mockClear();
});

// ---------------------------------------------------------------------------
// The iOS trees — what `../native` resolves to in node
// ---------------------------------------------------------------------------

describe('platform resolution', () => {
  it('../native resolves to the .ios.tsx tree, not the Android twin', () => {
    expect(SegmentedPicker).not.toBe(SegmentedPickerAndroid);
    expect(ConfirmDialog).not.toBe(ConfirmDialogAndroid);
    const tree = render(
      <SegmentedPicker
        options={['Loop', 'A → B']}
        selectedIndex={0}
        onChange={() => {}}
        label="Shape"
      />,
    );
    expect(hosts(tree, 'expo-ui-host')).toHaveLength(1);
    expect(hosts(tree, 'rn-pressable')).toHaveLength(0);
  });
});

describe('SegmentedPicker (iOS)', () => {
  const OPTIONS = ['Private', 'Link only', 'Public'] as const;

  it('is a segmented Picker inside a height-matching Host, with the options as Text tags', () => {
    const tree = render(
      <SegmentedPicker
        options={OPTIONS}
        selectedIndex={1}
        onChange={() => {}}
        label="Who can see this"
        testID="visibility"
      />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');

    const h = host(tree, 'expo-ui-host');
    expect(h.props['matchContents']).toEqual({ vertical: true });
    expect(h.props['colorScheme']).toBe('dark');
    expect(h.props['testID']).toBe('visibility');

    const picker = host(tree, 'expo-ui-picker');
    // The REAL prop name is `selection`; it carries the wrapper's selectedIndex.
    expect(picker.props['selection']).toBe(1);
    expect(picker.props['label']).toBe('Who can see this');
    expect(picker.props['modifiers']).toEqual([{ $type: 'pickerStyle', style: 'segmented' }]);

    const options = hosts(tree, 'expo-ui-text');
    expect(options.map((o) => o.props['children'])).toEqual(['Private', 'Link only', 'Public']);
    expect(options.map((o) => o.props['modifiers'])).toEqual([
      [{ $type: 'tag', tag: 0 }],
      [{ $type: 'tag', tag: 1 }],
      [{ $type: 'tag', tag: 2 }],
    ]);
    for (const o of OPTIONS) expect(json).toContain(o);
  });

  it('onChange fires from the picker onSelectionChange with ONE selection haptic; never for the current index', () => {
    const onChange = vi.fn();
    const tree = render(
      <SegmentedPicker
        options={OPTIONS}
        selectedIndex={0}
        onChange={onChange}
        label="Visibility"
      />,
    );
    const picker = host(tree, 'expo-ui-picker');
    call(picker, 'onSelectionChange', 2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2);
    expect(__haptics).toEqual(['selection']);

    // Native echoes the current value on appear — not a tick, not a haptic.
    call(picker, 'onSelectionChange', 0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(__haptics).toEqual(['selection']);
  });

  it('carries per-segment announced names, a hint and the disabled state as modifiers', () => {
    const tree = render(
      <SegmentedPicker
        options={OPTIONS}
        selectedIndex={0}
        onChange={() => {}}
        label="Visibility"
        segmentAccessibilityLabel={(o) => `Set visibility ${o.toLowerCase()}`}
        accessibilityHint="Stop 1: type"
        disabled
      />,
    );
    const options = hosts(tree, 'expo-ui-text');
    expect(options[1]?.props['modifiers']).toEqual([
      { $type: 'tag', tag: 1 },
      { $type: 'accessibilityLabel', label: 'Set visibility link only' },
    ]);
    expect(host(tree, 'expo-ui-picker').props['modifiers']).toEqual([
      { $type: 'pickerStyle', style: 'segmented' },
      { $type: 'accessibilityHint', hint: 'Stop 1: type' },
      { $type: 'disabled', disabled: true },
    ]);
  });

  it('refuses more than four (or fewer than two) options in dev — that is a MenuPicker', () => {
    expect(() =>
      render(
        <SegmentedPicker
          options={['Any', '30 min', '1 hr', '2 hr', '3 hr', '4 hr']}
          selectedIndex={0}
          onChange={() => {}}
          label="Drive time"
        />,
      ),
    ).toThrow(/MenuPicker/);
    expect(() =>
      render(
        <SegmentedPicker options={['Only']} selectedIndex={0} onChange={() => {}} label="One" />,
      ),
    ).toThrow(/2 to 4/);
  });
});

describe('MenuPicker (iOS)', () => {
  const DURATIONS = ['Any', '30 min', '1 hr', '2 hr', '3 hr', '4 hr'];

  it('is a labelled row: the label in Contour ink, a Spacer, then a menu Picker with its label hidden', () => {
    const tree = render(
      <MenuPicker options={DURATIONS} selectedIndex={2} onChange={() => {}} label="Drive time" />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');
    expect(host(tree, 'expo-ui-host').props['matchContents']).toEqual({ vertical: true });

    const row = host(tree, 'expo-ui-hstack');
    expect(row.props['modifiers']).toEqual([{ $type: 'frame', minHeight: HIT_TARGET }]);
    const texts = hosts(tree, 'expo-ui-text');
    expect(texts[0]?.props['children']).toBe('Drive time');
    expect(texts[0]?.props['modifiers']).toEqual([
      { $type: 'foregroundStyle', styleType: 'color', color: darkColors.text },
    ]);
    expect(hosts(tree, 'expo-ui-spacer')).toHaveLength(1);

    const picker = host(tree, 'expo-ui-picker');
    expect(picker.props['selection']).toBe(2);
    expect(picker.props['label']).toBe('Drive time');
    expect(picker.props['modifiers']).toEqual([
      { $type: 'pickerStyle', style: 'menu' },
      { $type: 'labelsHidden' },
      { $type: 'tint', color: darkColors.accentText },
    ]);
    // Every option is in the tree — one tap shows the whole set.
    for (const d of DURATIONS) expect(json).toContain(d);
    expect(texts.slice(1).map((t) => t.props['children'])).toEqual(DURATIONS);
  });

  it('onChange fires from onSelectionChange with one selection haptic; never for the current index', () => {
    const onChange = vi.fn();
    const tree = render(
      <MenuPicker options={DURATIONS} selectedIndex={0} onChange={onChange} label="Drive time" />,
    );
    const picker = host(tree, 'expo-ui-picker');
    call(picker, 'onSelectionChange', 4);
    call(picker, 'onSelectionChange', 0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);
    expect(__haptics).toEqual(['selection']);
  });
});

describe('NativeToggle (iOS)', () => {
  it('is a labelled Toggle; onChange fires from onIsOnChange with NO haptic (UISwitch plays its own)', () => {
    const onChange = vi.fn();
    const tree = render(<NativeToggle value={false} onChange={onChange} label="Avoid highways" />);
    expect(textOf(tree)).not.toContain('down');
    const toggle = host(tree, 'expo-ui-toggle');
    expect(toggle.props['isOn']).toBe(false);
    expect(toggle.props['label']).toBe('Avoid highways');
    expect(toggle.props['modifiers']).toEqual([
      { $type: 'toggleStyle', style: 'switch' },
      { $type: 'tint', color: darkColors.accent },
      { $type: 'foregroundStyle', styleType: 'color', color: darkColors.text },
      { $type: 'frame', minHeight: HIT_TARGET },
    ]);
    call(toggle, 'onIsOnChange', true);
    call(toggle, 'onIsOnChange', false); // the value it already holds — an echo
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(__haptics).toEqual([]);
  });

  it('forwards disabled as a modifier', () => {
    const tree = render(
      <NativeToggle value onChange={() => {}} label="Paved roads only" disabled />,
    );
    expect(host(tree, 'expo-ui-toggle').props['modifiers']).toContainEqual({
      $type: 'disabled',
      disabled: true,
    });
  });
});

describe('ConfirmDialog (iOS)', () => {
  const dialog = (
    isPresented: boolean,
    onPress: () => void,
    onIsPresentedChange: (v: boolean) => void = () => {},
  ): ReactElement => (
    <ConfirmDialog
      isPresented={isPresented}
      onIsPresentedChange={onIsPresentedChange}
      title="Delete “My loop”?"
      message="This can't be undone."
      actions={[
        {
          title: 'Delete',
          role: 'destructive',
          accessibilityLabel: 'Confirm delete drive',
          onPress,
        },
        { title: 'Cancel', role: 'cancel', onPress: () => {} },
      ]}
    />
  );

  it('renders no action until presented — only the anchor; dialogPresented is false', () => {
    const onPress = vi.fn();
    const tree = render(dialog(false, onPress));
    expect(dialogPresented(tree)).toBe(false);
    const json = textOf(tree);
    expect(json).not.toContain('down');
    expect(hosts(tree, 'expo-ui-button')).toHaveLength(0);
    expect(json).not.toContain("This can't be undone.");
    expect(json).not.toContain('"label":"Delete"');
    // The tree stays mounted: the dialog modifier is attached to a real anchor.
    expect(host(tree, 'expo-ui-confirmationdialog').props['isPresented']).toBe(false);
    expect(host(tree, 'expo-ui-confirmationdialog').props['titleVisibility']).toBe('visible');
    expect(host(tree, 'expo-ui-rectangle').props['modifiers']).toEqual([
      { $type: 'frame', width: 1, height: 1 },
      { $type: 'foregroundStyle', styleType: 'color', color: 'clear' },
    ]);
    expect(host(tree, 'expo-ui-host').props['style']).toEqual({
      position: 'absolute',
      top: 0,
      left: 0,
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('presented: confirmDialog(tree, "Delete") runs the destructive action ONCE with ONE Medium haptic and closes', async () => {
    const onPress = vi.fn();
    const onIsPresentedChange = vi.fn();
    const tree = render(dialog(true, onPress, onIsPresentedChange));
    expect(dialogPresented(tree)).toBe(true);
    const json = textOf(tree);
    expect(json).toContain("This can't be undone.");
    expect(json).toContain('Delete “My loop”?');

    const buttons = hosts(tree, 'expo-ui-button');
    expect(buttons.map((b) => b.props['label'])).toEqual(['Delete', 'Cancel']);
    expect(buttons[0]?.props['role']).toBe('destructive');
    expect(buttons[0]?.props['modifiers']).toEqual([
      { $type: 'accessibilityLabel', label: 'Confirm delete drive' },
    ]);
    expect(buttons[1]?.props['role']).toBe('cancel');

    await confirmDialog(tree, 'Delete');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onIsPresentedChange).toHaveBeenCalledWith(false);
    expect(__haptics).toEqual(['impact:Medium']);
  });

  it('the helper also finds the action by its accessibilityLabel; a cancel plays no haptic', async () => {
    const onPress = vi.fn();
    const tree = render(dialog(true, onPress));
    await confirmDialog(tree, 'Confirm delete drive');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(__haptics).toEqual(['impact:Medium']);

    __resetHaptics();
    await confirmDialog(tree, 'Cancel');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(__haptics).toEqual([]);
  });

  it('the helper refuses to press through a dialog that is not presented, or an action that is not there', async () => {
    const closed = render(dialog(false, () => {}));
    await expect(confirmDialog(closed, 'Delete')).rejects.toThrow(/no ConfirmDialog is presented/);
    const open = render(dialog(true, () => {}));
    await expect(confirmDialog(open, 'Discard')).rejects.toThrow(/exactly one/);
  });

  it('a screen that flips isPresented re-presents the same mounted tree', () => {
    const tree = render(dialog(false, () => {}));
    expect(dialogPresented(tree)).toBe(false);
    act(() => {
      tree.update(dialog(true, () => {}));
    });
    expect(dialogPresented(tree)).toBe(true);
    expect(hosts(tree, 'expo-ui-button')).toHaveLength(2);
    act(() => {
      tree.update(dialog(false, () => {}));
    });
    expect(dialogPresented(tree)).toBe(false);
    expect(hosts(tree, 'expo-ui-button')).toHaveLength(0);
  });
});

describe('HeaderMenu (iOS)', () => {
  it('is a Menu under the ellipsis.circle glyph, framed to the hit target; every action is invocable', () => {
    const rename = vi.fn();
    const remove = vi.fn();
    const tree = render(
      <HeaderMenu
        actions={[
          { title: 'Rename', symbol: 'pencil', onPress: rename },
          {
            title: 'Delete drive',
            symbol: 'trash',
            role: 'destructive',
            accessibilityLabel: 'Delete drive',
            onPress: remove,
          },
        ]}
      />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');

    const menu = host(tree, 'expo-ui-menu');
    expect(menu.props['modifiers']).toEqual([
      { $type: 'accessibilityLabel', label: 'More actions' },
      { $type: 'frame', width: HIT_TARGET, height: HIT_TARGET },
    ]);
    // The label is SwiftUI content: an Image of the glyph from the one table.
    const label = host(tree, 'expo-ui-slot');
    expect(label.props['name']).toBe('label');
    const glyph = label.find(ofTag('expo-ui-image'));
    expect(glyph.props['systemName']).toBe(SYMBOLS.ellipsisCircle.sf);
    expect(glyph.props['color']).toBe(darkColors.accentText);

    const items = hosts(tree, 'expo-ui-button');
    expect(items.map((b) => b.props['label'])).toEqual(['Rename', 'Delete drive']);
    expect(items[0]?.props['systemImage']).toBe('pencil');
    expect(items[1]?.props['systemImage']).toBe('trash');
    expect(items[1]?.props['role']).toBe('destructive');
    expect(items[1]?.props['modifiers']).toEqual([
      { $type: 'accessibilityLabel', label: 'Delete drive' },
    ]);
    call(items[0]!, 'onPress');
    call(items[1]!, 'onPress');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    // A menu item plays nothing — the ConfirmDialog it leads to does.
    expect(__haptics).toEqual([]);
  });

  it('takes an announced name of its own', () => {
    const tree = render(
      <HeaderMenu
        accessibilityLabel="Spot actions"
        actions={[{ title: 'Edit', onPress: () => {} }]}
      />,
    );
    expect(host(tree, 'expo-ui-menu').props['modifiers']).toContainEqual({
      $type: 'accessibilityLabel',
      label: 'Spot actions',
    });
  });
});

describe('EmptyState (iOS)', () => {
  it('is a ContentUnavailableView with the title, description and the glyph from the table, plus the action', () => {
    const retry = vi.fn();
    const tree = render(
      <EmptyState
        symbol="wifiSlash"
        title="Couldn't load your drives"
        description="Check your connection."
        action={<Button title="Retry" accessibilityLabel="Retry loading drives" onPress={retry} />}
      />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');
    const view = host(tree, 'expo-ui-contentunavailableview');
    expect(view.props['title']).toBe("Couldn't load your drives");
    expect(view.props['description']).toBe('Check your connection.');
    expect(view.props['systemImage']).toBe(SYMBOLS.wifiSlash.sf);
    expect(host(tree, 'expo-ui-host').props['matchContents']).toEqual({ vertical: true });
    // The action is the screen's own RN Button — its label and handler intact.
    expect(json).toContain('"accessibilityLabel":"Retry loading drives"');
    const button = tree.root.find((n) => n.props['accessibilityLabel'] === 'Retry loading drives');
    call(button, 'onPress');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(__haptics).toEqual([]);
  });

  it('a description is optional and never invented', () => {
    const tree = render(
      <EmptyState symbol="map" title="No route arrived — go back and plan again." />,
    );
    expect(host(tree, 'expo-ui-contentunavailableview').props['description']).toBeUndefined();
    expect(textOf(tree)).toContain('No route arrived — go back and plan again.');
  });
});

// ---------------------------------------------------------------------------
// The Android twins — named by their explicit .android path
// ---------------------------------------------------------------------------

describe('the Android twins render the same contract on RN primitives', () => {
  it('SegmentedPicker: the Chip track in a radiogroup; a tap ticks once', () => {
    const onChange = vi.fn();
    const tree = render(
      <SegmentedPickerAndroid
        options={['Loop', 'A → B']}
        selectedIndex={0}
        onChange={onChange}
        label="Shape"
        segmentAccessibilityLabel={(o) => `Set shape ${o}`}
      />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');
    expect(json).not.toContain('expo-ui');
    expect(json).toContain('"accessibilityRole":"radiogroup"');
    expect(json).toContain('"accessibilityLabel":"Shape"');
    expect(json).toContain('"accessibilityLabel":"Set shape A → B"');
    // Host elements only: a composite (`Chip` → `PressableScale`) carries the
    // same role prop on its way down, and would double the count.
    const chips = hosts(tree, 'rn-pressable').filter(
      (n) => n.props['accessibilityRole'] === 'radio',
    );
    expect(chips).toHaveLength(2);
    expect(chips[0]?.props['accessibilityState']).toMatchObject({ selected: true });
    call(chips[1]!, 'onPress');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(1);
    expect(__haptics).toEqual(['selection']);
    call(chips[0]!, 'onPress'); // the selected segment — not a tick, not a haptic
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(__haptics).toEqual(['selection']);
    expect(() =>
      render(
        <SegmentedPickerAndroid
          options={['1', '2', '3', '4', '5']}
          selectedIndex={0}
          onChange={() => {}}
          label="Too many"
        />,
      ),
    ).toThrow(/MenuPicker/);
  });

  it('MenuPicker: a Row with the label, the current value and a turned chevron; the dialog lists every option', () => {
    const onChange = vi.fn();
    const options = ['Any', '30 min', '1 hr', '2 hr', '3 hr', '4 hr'];
    const tree = render(
      <MenuPickerAndroid
        options={options}
        selectedIndex={2}
        onChange={onChange}
        label="Drive time"
      />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');
    expect(json).toContain('"accessibilityLabel":"Drive time, 1 hr"');
    expect(json).toContain('"rotate":"90deg"');
    for (const o of options) expect(json).toContain(o);
    const row = tree.root.find((n) => n.props['accessibilityLabel'] === '4 hr');
    call(row, 'onPress');
    expect(onChange).toHaveBeenCalledWith(5);
    expect(__haptics).toEqual(['selection']);
  });

  it('NativeToggle: an RN Switch carrying the label; onValueChange is the screen onChange', () => {
    const onChange = vi.fn();
    const tree = render(
      <NativeToggleAndroid value={false} onChange={onChange} label="Prefer views" />,
    );
    const sw = host(tree, 'rn-switch');
    expect(sw.props['value']).toBe(false);
    expect(sw.props['accessibilityLabel']).toBe('Prefer views');
    expect(sw.props['trackColor']).toEqual({
      false: darkColors.borderStrong,
      true: darkColors.accent,
    });
    call(sw, 'onValueChange', true);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(textOf(tree)).toContain('Prefer views');
  });

  it('ConfirmDialog: Alert.alert once when presented — Cancel first, the destructive action last; the action runs once with one Medium haptic', () => {
    const onPress = vi.fn();
    const onIsPresentedChange = vi.fn();
    const props = {
      onIsPresentedChange,
      title: 'Discard this recording?',
      message: 'The capture will be lost.',
      actions: [
        { title: 'Discard', role: 'destructive' as const, onPress },
        { title: 'Keep', role: 'cancel' as const, onPress: () => {} },
      ],
    };
    const tree = render(<ConfirmDialogAndroid isPresented={false} {...props} />);
    expect(tree.toJSON()).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();

    act(() => {
      tree.update(<ConfirmDialogAndroid isPresented {...props} />);
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons, options] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(title).toBe('Discard this recording?');
    expect(message).toBe('The capture will be lost.');
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Keep', 'cancel'],
      ['Discard', 'destructive'],
    ]);
    expect(options).toMatchObject({ cancelable: true });

    act(() => {
      buttons?.[1]?.onPress?.();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onIsPresentedChange).toHaveBeenCalledWith(false);
    expect(__haptics).toEqual(['impact:Medium']);
  });

  it('ConfirmDialog: adds its own Cancel when none is given, and ignores a press after the screen moved on', () => {
    const onPress = vi.fn();
    const onIsPresentedChange = vi.fn();
    const actions = [{ title: 'Delete', role: 'destructive' as const, onPress }];
    const tree = render(
      <ConfirmDialogAndroid
        isPresented
        onIsPresentedChange={onIsPresentedChange}
        title="Delete this spot?"
        actions={actions}
      />,
    );
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(buttons?.map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    act(() => {
      tree.update(
        <ConfirmDialogAndroid
          isPresented={false}
          onIsPresentedChange={onIsPresentedChange}
          title="Delete this spot?"
          actions={actions}
        />,
      );
    });
    act(() => {
      buttons?.[1]?.onPress?.();
    });
    expect(onPress).not.toHaveBeenCalled();
    expect(__haptics).toEqual([]);
  });

  it('HeaderMenu: a 44pt ellipsis button that opens an Alert-style list; three actions fill the three slots', () => {
    const edit = vi.fn();
    const tree = render(
      <HeaderMenuAndroid
        actions={[
          { title: 'Edit', onPress: edit },
          { title: 'Report this', onPress: () => {} },
          { title: 'Delete', role: 'destructive', onPress: () => {} },
        ]}
      />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');
    expect(host(tree, 'rn-icon').props['iconName']).toBe(SYMBOLS.ellipsisCircle.ionicons);
    const button = tree.root.find((n) => n.props['accessibilityLabel'] === 'More actions');
    call(button, 'onPress');
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Edit', 'default'],
      ['Report this', 'default'],
      ['Delete', 'destructive'],
    ]);
    act(() => {
      buttons?.[0]?.onPress?.();
    });
    expect(edit).toHaveBeenCalledTimes(1);

    // Two actions get an explicit Cancel in the first slot.
    vi.mocked(Alert.alert).mockClear();
    const two = render(
      <HeaderMenuAndroid
        actions={[
          { title: 'Rename', onPress: () => {} },
          { title: 'Delete drive', role: 'destructive', onPress: () => {} },
        ]}
      />,
    );
    call(
      two.root.find((n) => n.props['accessibilityLabel'] === 'More actions'),
      'onPress',
    );
    const [, , twoButtons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(twoButtons?.map((b) => b.text)).toEqual(['Cancel', 'Rename', 'Delete drive']);
  });

  it('EmptyState: the glyph, the title and the description on RN, with the action beneath', () => {
    const tree = render(
      <EmptyStateAndroid
        symbol="lock"
        title="Your session expired"
        description="Sign in to open this drive."
        action={<Button title="Sign in" onPress={() => {}} />}
      />,
    );
    const json = textOf(tree);
    expect(json).not.toContain('down');
    expect(json).not.toContain('expo-ui');
    expect(host(tree, 'rn-icon').props['iconName']).toBe(SYMBOLS.lock.ionicons);
    expect(json).toContain('Your session expired');
    expect(json).toContain('Sign in to open this drive.');
    expect(json).toContain('"accessibilityLabel":"Sign in"');
  });
});
