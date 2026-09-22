/**
 * The '@expo/ui/swift-ui' stub (BD-204 redesign).
 *
 * Components come from '@expo/ui/swift-ui' and modifiers from
 * '@expo/ui/swift-ui/modifiers' BY PACKAGE NAME — the two specifiers a screen
 * uses — which is what proves both aliases in app/vitest.config.ts resolve
 * (the real modules call requireNativeView at import and throw in node), and
 * that the modifiers subpath is not swallowed by the bare one. It also means
 * this file type-checks against the REAL types (tsc resolves the real package;
 * only vitest sees the stub). The one `__` hook comes from the stub's own path
 * (the real types do not declare it) and acts on the same module instance.
 *
 * It pins the properties the screen suite will lean on: the sheet tree
 * serialises, presented content shows and hidden content does not, option copy
 * is findable, callbacks are invocable under their REAL names, modifiers
 * survive as plain descriptors, and no cyclic / instance / element prop ever
 * reaches a host element.
 */

import {
  Alert,
  BottomSheet,
  Button,
  ContextMenu,
  DisclosureGroup,
  Group,
  Host,
  Picker,
  Text,
  TextField,
  Toggle,
  VStack,
  type GroupProps,
  type TextFieldRef,
} from '@expo/ui/swift-ui';
import {
  Animation,
  animation,
  background,
  environment,
  foregroundStyle,
  lineLimit,
  onTapGesture,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { act, createRef, type ReactElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { __setLayoutContentSize } from '../expo-ui-stub';

function render(node: ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());

/** Matches a stub's host element by tag. A predicate rather than
 *  `findByType`, whose parameter is React's `ElementType` — DOM tag names
 *  only under strict TS, so a stub's own tag would not type-check. */
const ofTag =
  (tag: string) =>
  (n: ReactTestInstance): boolean =>
    n.type === tag;

const host = (tree: ReactTestRenderer, tag: string): ReactTestInstance =>
  tree.root.find(ofTag(tag));

/** A class instance whose graph loops back on itself — what a ref's `current`
 *  or an unresolved animated node looks like to JSON.stringify. */
class Cyclic {
  self: Cyclic;
  constructor() {
    this.self = this;
  }
}

afterEach(() => {
  __setLayoutContentSize(null);
});

describe('@expo/ui stub — the sheet tree the redesign is built on', () => {
  const sheet = (isPresented: boolean, seenOn: boolean[] = []): ReactElement => (
    <Host style={{ flex: 1 }}>
      <BottomSheet isPresented={isPresented} onIsPresentedChange={() => {}}>
        <Group modifiers={[presentationDetents(['medium']), presentationDragIndicator('visible')]}>
          <Picker label="Route style" selection="scenic" onSelectionChange={() => {}}>
            <Text modifiers={[tag('scenic')]}>Scenic loop</Text>
            <Text modifiers={[tag('direct')]}>Direct road</Text>
          </Picker>
          <Toggle isOn={false} label="Avoid highways" onIsOnChange={(v) => seenOn.push(v)} />
        </Group>
      </BottomSheet>
    </Host>
  );

  it('Host > BottomSheet(presented) > Group(detents) > Picker(Text tags) + Toggle serialises', () => {
    const seenOn: boolean[] = [];
    const tree = render(sheet(true, seenOn));

    // The one property the suite lives or dies on.
    expect(() => textOf(tree)).not.toThrow();
    const json = textOf(tree);

    // Host elements are findable by their library-prefixed tag.
    expect(json).toContain('"type":"expo-ui-host"');
    expect(json).toContain('"type":"expo-ui-bottomsheet"');
    expect(json).toContain('"type":"expo-ui-group"');
    expect(json).toContain('"type":"expo-ui-picker"');
    expect(json).toContain('"type":"expo-ui-toggle"');

    // The option copy is present, as the child of a TEXT host.
    expect(json).toContain('Scenic loop');
    expect(json).toContain('Direct road');
    const options = tree.root.findAll(ofTag('expo-ui-text'));
    expect(options.map((o) => o.props['children'])).toEqual(['Scenic loop', 'Direct road']);
    // …and each option's tag survived as a plain descriptor.
    expect(options[0]?.props['modifiers']).toEqual([{ $type: 'tag', tag: 'scenic' }]);

    // The toggle's callback is forwarded under its REAL name and is invocable.
    const toggle = host(tree, 'expo-ui-toggle');
    expect(toggle.props['isOn']).toBe(false);
    expect(toggle.props['label']).toBe('Avoid highways');
    act(() => {
      (toggle.props['onIsOnChange'] as (v: boolean) => void)(true);
    });
    expect(seenOn).toEqual([true]);

    // The detent descriptor serialised, exactly as the real modifier builds it.
    expect(json).toContain('"$type":"presentationDetents"');
    expect(json).toContain('"detents":["medium"]');
    expect(host(tree, 'expo-ui-group').props['modifiers']).toEqual([
      { $type: 'presentationDetents', detents: ['medium'], selection: undefined },
      { $type: 'presentationDragIndicator', visibility: 'visible' },
    ]);

    // Picker forwards its selection; a string label stays a prop.
    const picker = host(tree, 'expo-ui-picker');
    expect(picker.props['selection']).toBe('scenic');
    expect(picker.props['label']).toBe('Route style');
    expect(typeof picker.props['onSelectionChange']).toBe('function');
  });

  it('BottomSheet hides its children until presented, and forwards isPresented', () => {
    const tree = render(sheet(false));
    const json = textOf(tree);
    expect(json).toContain('"type":"expo-ui-bottomsheet"');
    expect(json).toContain('"isPresented":false');
    expect(json).not.toContain('Scenic loop');
    expect(json).not.toContain('expo-ui-toggle');
    expect(typeof host(tree, 'expo-ui-bottomsheet').props['onIsPresentedChange']).toBe('function');
  });
});

describe('@expo/ui stub — serialisation guard', () => {
  it('strips cycles, class instances and animated builders; renders an element prop as a slot', () => {
    const cyclic = new Cyclic();
    const looped: Record<string, unknown> = { a: 1 };
    looped['self'] = looped;
    const spring = Animation.spring({ duration: 0.8 }).delay(0.1);
    // Widened on purpose: the real GroupProps would refuse these, which is
    // exactly why the guard must not rely on the type system.
    const evil = {
      instance: cyclic,
      looped,
      builder: spring,
      when: new Date('2026-09-13T00:00:00.000Z'),
      label: <Text>Slotted label</Text>,
      modifiers: [animation(spring, true), onTapGesture(() => {})],
      children: <Text>Body</Text>,
    } as unknown as GroupProps;

    const tree = render(
      <Host>
        <Group {...evil} />
      </Host>,
    );
    expect(() => textOf(tree)).not.toThrow();
    const group = host(tree, 'expo-ui-group');
    expect(group.props['instance']).toBeUndefined();
    expect(group.props['looped']).toEqual({ a: 1 });
    // `builder` is a plain object of functions; JSON keeps `{}` of it, never a cycle.
    expect(JSON.stringify(group.props['builder'])).toBe('{}');
    expect(group.props['when']).toBe('2026-09-13T00:00:00.000Z');
    expect(group.props['label']).toBeUndefined();
    const slot = host(tree, 'expo-ui-slot');
    expect(slot.props['name']).toBe('label');
    expect(textOf(tree)).toContain('Slotted label');
    // The animation modifier carries the unwrapped AnimationObject, not the builder.
    expect(group.props['modifiers']).toEqual([
      {
        $type: 'animation',
        animation: {
          type: 'spring',
          response: undefined,
          dampingFraction: undefined,
          blendDuration: undefined,
          duration: 0.8,
          bounce: undefined,
          delay: 0.1,
        },
        animatedValue: true,
      },
      { $type: 'onTapGesture', eventListener: expect.any(Function) },
    ]);
  });

  it('modifiers build the same descriptors as the real package', () => {
    expect(foregroundStyle({ type: 'hierarchical', style: 'secondary' })).toEqual({
      $type: 'foregroundStyle',
      styleType: 'hierarchical',
      hierarchicalStyle: 'secondary',
    });
    expect(foregroundStyle('#ff0000')).toEqual({
      $type: 'foregroundStyle',
      styleType: 'color',
      color: '#ff0000',
    });
    expect(background('#000', shapes.roundedRectangle({ cornerRadius: 12 }))).toEqual({
      $type: 'background',
      color: '#000',
      cornerRadius: 12,
      roundedCornerStyle: undefined,
      cornerSize: undefined,
      shape: 'roundedRectangle',
    });
    expect(
      presentationBackgroundInteraction({ type: 'enabledUpThrough', detent: 'medium' }),
    ).toEqual({
      $type: 'presentationBackgroundInteraction',
      interactionType: 'enabledUpThrough',
      detent: 'medium',
    });
    expect(lineLimit({ min: 1, max: 3 })).toEqual({ $type: 'lineLimit', min: 1, max: 3 });
    expect(lineLimit(2, { reservesSpace: true })).toEqual({
      $type: 'lineLimit',
      limit: 2,
      reservesSpace: true,
    });
    expect(environment('colorScheme', 'dark')).toEqual({
      $type: 'environment',
      key: 'colorScheme',
      value: 'dark',
    });
    // A detent selection listener is a function on the descriptor, invocable by a test.
    const picked: unknown[] = [];
    const detents = presentationDetents(['medium', 'large'], {
      onSelectionChange: (d) => picked.push(d),
    });
    (detents.eventListener as (args: { detent: string }) => void)({ detent: 'large' });
    expect(picked).toEqual(['large']);
  });
});

describe('@expo/ui stub — text and the bare-text invariant', () => {
  it('Text joins simple children into one string and drops non-Text elements', () => {
    const tree = render(
      <Host>
        <VStack>
          <Text>{3} stops</Text>
          <Text>
            Outer <Text>inner</Text>
            <VStack>never</VStack>
          </Text>
        </VStack>
      </Host>,
    );
    const json = textOf(tree);
    expect(json).toContain('"3 stops"');
    expect(json).toContain('inner');
    expect(json).not.toContain('never');
    expect(tree.root.findAll(ofTag('expo-ui-vstack'))).toHaveLength(1);
  });

  it('a bare string outside Text throws, including a string child of Button', () => {
    expect(() =>
      render(
        <Host>
          <VStack>bare</VStack>
        </Host>,
      ),
    ).toThrow(/bare string "bare" inside <expo-ui-vstack>/);
    expect(() =>
      render(
        <Host>
          {/* @ts-expect-error the real Button has no string-children form */}
          <Button onPress={() => {}}>Save</Button>
        </Host>,
      ),
    ).toThrow(/bare string "Save" inside <expo-ui-button>/);
  });

  it('Button forwards onPress and its label prop, so copy and control are both findable', () => {
    let pressed = 0;
    const tree = render(
      <Host>
        <Button label="Plan the drive" role="cancel" onPress={() => void pressed++} />
      </Host>,
    );
    expect(textOf(tree)).toContain('Plan the drive');
    const button = host(tree, 'expo-ui-button');
    act(() => {
      (button.props['onPress'] as () => void)();
    });
    expect(pressed).toBe(1);
    expect(button.props['role']).toBe('cancel');
  });
});

describe('@expo/ui stub — presented / expanded gating', () => {
  const dialog = (isPresented: boolean): ReactElement => (
    <Host>
      <Alert title="Delete this drive?" isPresented={isPresented} onIsPresentedChange={() => {}}>
        <Alert.Trigger>
          <Button label="Delete" role="destructive" />
        </Alert.Trigger>
        <Alert.Message>
          <Text>This cannot be undone.</Text>
        </Alert.Message>
        <Alert.Actions>
          <Button label="Confirm delete" role="destructive" />
        </Alert.Actions>
      </Alert>
    </Host>
  );

  it('Alert shows only its Trigger until presented, then everything', () => {
    const closed = textOf(render(dialog(false)));
    expect(closed).toContain('Delete this drive?'); // the title is a prop either way
    expect(closed).toContain('"label":"Delete"');
    expect(closed).not.toContain('This cannot be undone.');
    expect(closed).not.toContain('Confirm delete');

    const open = textOf(render(dialog(true)));
    expect(open).toContain('This cannot be undone.');
    expect(open).toContain('Confirm delete');
    expect(open).toContain('"name":"message"');
    expect(open).toContain('"name":"actions"');
  });

  it('DisclosureGroup hides content until expanded; ContextMenu items render inline', () => {
    const collapsed = textOf(
      render(
        <Host>
          <DisclosureGroup label="Advanced">
            <Text>Hidden detail</Text>
          </DisclosureGroup>
        </Host>,
      ),
    );
    expect(collapsed).toContain('Advanced');
    expect(collapsed).not.toContain('Hidden detail');

    const expanded = textOf(
      render(
        <Host>
          <DisclosureGroup label="Advanced" isExpanded>
            <Text>Hidden detail</Text>
          </DisclosureGroup>
          <ContextMenu>
            <ContextMenu.Trigger>
              <Text>Long-press me</Text>
            </ContextMenu.Trigger>
            <ContextMenu.Items>
              <Button label="Share" />
            </ContextMenu.Items>
          </ContextMenu>
        </Host>,
      ),
    );
    expect(expanded).toContain('Hidden detail');
    expect(expanded).toContain('Long-press me');
    expect(expanded).toContain('"label":"Share"');
  });
});

describe('@expo/ui stub — node-only affordances', () => {
  it('TextField exposes the real ref handle, resolving without a keyboard', async () => {
    const ref = createRef<TextFieldRef>();
    const tree = render(
      <Host>
        <TextField ref={ref} placeholder="Where to?" onValueChange={() => {}} />
      </Host>,
    );
    expect(ref.current).not.toBeNull();
    await expect(ref.current?.focus()).resolves.toBeUndefined();
    await expect(ref.current?.setText('Muskoka')).resolves.toBeUndefined();
    // The ref never reaches the host element.
    expect(host(tree, 'expo-ui-textfield').props['ref']).toBeUndefined();
    expect(host(tree, 'expo-ui-textfield').props['placeholder']).toBe('Where to?');
  });

  it('__setLayoutContentSize drives Host.onLayoutContent once on mount (restored in afterEach)', () => {
    const sizes: Array<{ width: number; height: number }> = [];
    __setLayoutContentSize({ width: 393, height: 240 });
    const tree = render(
      <Host matchContents onLayoutContent={(e) => sizes.push(e.nativeEvent)}>
        <Text>Sized</Text>
      </Host>,
    );
    expect(sizes).toEqual([{ width: 393, height: 240 }]);
    act(() => {
      tree.update(
        <Host matchContents onLayoutContent={(e) => sizes.push(e.nativeEvent)}>
          <Text>Sized again</Text>
        </Host>,
      );
    });
    expect(sizes).toHaveLength(1); // a new inline handler does not re-fire it
    expect(host(tree, 'expo-ui-host').props['matchContents']).toBe(true);
  });
});
