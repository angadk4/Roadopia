/**
 * Node-safe stand-in for '@expo/ui/swift-ui' AND '@expo/ui/swift-ui/modifiers'
 * (vitest alias — BD-204 redesign). One file, iOS naming; the verifier points
 * the jetpack-compose subpaths here too, so production code must use the
 * swift-ui names everywhere (the app never imports a Compose-only component).
 *
 * Why it exists. Every real component calls `requireNativeView('ExpoUI', …)`
 * at MODULE scope, and every real modifier file goes through
 * `requireNativeModule('ExpoUI')`, so a single `<Host>` in a tested screen
 * takes the whole suite down at import time. Here each component is a plain
 * host element named `expo-ui-<component>` (lowercase) that wraps its
 * children, so a screen test can find it by tag and read what the app asked
 * for. Prop NAMES are the real ones (`isOn`/`onIsOnChange`, `selection`/
 * `onSelectionChange`, `label`, `isPresented`, `modifiers`, …): production
 * code type-checks against the real package and merely RUNS against this
 * file, so the runtime shape has to match what the real code forwards.
 *
 * Serialisation guard (the property the suite lives or dies on). Screen tests
 * assert over `JSON.stringify(tree.toJSON())`, and react-test-renderer
 * serialises host props, so one cyclic prop reaching a host element turns
 * 474 tests into "Converting circular structure to JSON". Every prop of every
 * host element therefore goes through `plain()` before createElement:
 *   - primitives pass; functions pass (test-renderer keeps them so a test can
 *     invoke `onPress`/`onIsOnChange`; JSON.stringify drops them);
 *   - plain arrays/objects are walked, with a path guard so a cycle is cut
 *     rather than looped over; a Date becomes its ISO string;
 *   - an rn-stub Animated node resolves to its current number (same marker
 *     rn-stub.tsx puts on them);
 *   - a React element given AS A PROP (`label={<Text/>}`, `icon`, `header`,
 *     `footer`, `currentValueLabel`, …) is RENDERED, as an `expo-ui-slot`
 *     child named after the prop, never forwarded — an element carries its
 *     owner fiber, which is a cycle;
 *   - anything else (class instance, symbol, builder with a prototype) is
 *     dropped — a missing prop is a visible gap in one assertion, a cycle is
 *     the whole suite.
 * Modifiers are already plain `{ $type, …params }` descriptors (the real
 * `createModifier` builds exactly that), so `modifiers` survives as data and a
 * test can assert e.g. that `presentationDetents` were declared. The only
 * builder in the real API, `Animation.*`, is unwrapped by `animation()` before
 * it becomes a descriptor, as on device.
 *
 * Visibility, not the React tree. On device a sheet's children MOUNT even
 * while `isPresented` is false (SwiftUI just does not present them). Here
 * `BottomSheet` renders its children ONLY when presented, and `Alert` /
 * `ConfirmationDialog` / `Popover` render only their `Trigger` slot until
 * presented, `DisclosureGroup` only its label until `isExpanded`, so a test can
 * assert what the sheet SHOWS versus hides. Consequence, stated plainly: the
 * mount effects of hidden children do not run in a test.
 *
 * Text. `Text` is the ONE text host: string/number children are joined into a
 * single string child of `expo-ui-text` (the real joins them into one native
 * `text` too), nested `Text` elements are kept, and any other element child is
 * dropped as the real does. Every other host mirrors RN's invariant (see
 * rn-stub `assertNoBareText`): a bare string child throws, which is also what
 * turns `<Button>Save</Button>` — a type error against the real, whose Button
 * takes `label="Save"` — into a CI failure instead of an empty button on
 * device.
 *
 * Deliberately NOT emulated (device-only): native presentation, layout and
 * animation (modifiers are declared, never applied; `Animation` presets are
 * data); Menu / ContextMenu open state (items render inline); `Text` date and
 * timer modes (timestamps are forwarded, no live text); `refreshable`'s
 * native `completeRefresh` handshake; `TextField` / `SecureField` ref methods
 * (they resolve immediately and move no focus); `Host.matchContents` is
 * forwarded as written (the real splits it into vertical/horizontal), and
 * `layoutDirection` is not defaulted from I18nManager; `ColorPicker.selection`
 * is not run through `processColor`; slot hosts are named by the PROP that
 * carried them, not the native slot id (`currentValueLabel`, not
 * `currentValue`). Nothing from `@expo/ui/jetpack-compose` is modelled.
 */

import {
  Children,
  createElement,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

// =============================================================================
// Shared types (mirrors src/swift-ui/types.ts + modifiers/types.ts)
// =============================================================================

/** The real type comes from 'sf-symbols-typescript' (a string union); any
 *  symbol name the real accepts is a string here. */
type SFSymbol = string;

/** RN's `ColorValue` without importing react-native: a string, or the opaque
 *  value `PlatformColor()` returns. */
type OpaqueColorValue = symbol & { __TYPE__: 'Color' };
type ColorValue = string | OpaqueColorValue;

type NamedColor =
  | 'primary'
  | 'secondary'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'white'
  | 'gray'
  | 'black'
  | 'clear'
  | 'mint'
  | 'teal'
  | 'cyan'
  | 'indigo'
  | 'brown';

export type Color = string | ColorValue | NamedColor;

export type Alignment =
  | 'center'
  | 'leading'
  | 'trailing'
  | 'top'
  | 'bottom'
  | 'topLeading'
  | 'topTrailing'
  | 'bottomLeading'
  | 'bottomTrailing'
  | 'centerFirstTextBaseline'
  | 'centerLastTextBaseline'
  | 'leadingFirstTextBaseline'
  | 'leadingLastTextBaseline'
  | 'trailingFirstTextBaseline'
  | 'trailingLastTextBaseline';

export type FrameProps = {
  width?: number;
  height?: number;
  minWidth?: number;
  idealWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  idealHeight?: number;
  maxHeight?: number;
  alignment?: Alignment;
};

export type PaddingProps = {
  top?: number;
  leading?: number;
  bottom?: number;
  trailing?: number;
};

export type ClosedRangeDate = { lower: Date; upper: Date };

/** Declared as `type` (not `interface`) on purpose, as is every prop type in
 *  this file: object-literal types carry an implicit index signature, which
 *  is what lets each component hand its props to `renderHost` untouched. */
export type CommonViewModifierProps = {
  testID?: string;
  modifiers?: ViewModifier[];
};

// =============================================================================
// Modifiers (mirrors src/swift-ui/modifiers/*)
// =============================================================================

export type ModifierConfig = {
  $type: string;
  [key: string]: unknown;
  eventListener?: (args: never) => void;
};

export function createModifier(type: string, params: Record<string, unknown> = {}): ModifierConfig {
  return { $type: type, ...params };
}

export function createModifierWithEventListener(
  type: string,
  eventListener: (args: never) => void,
  params: Record<string, unknown> = {},
): ModifierConfig {
  return { $type: type, ...params, eventListener };
}

export type GlobalEventPayload = { [eventName: string]: Record<string, unknown> };
export type GlobalEvent = {
  onGlobalEvent: (event: { nativeEvent: GlobalEventPayload }) => void;
};

/** The real dispatcher, kept for import shape; nothing in node emits a
 *  global event, so a test drives a modifier's `eventListener` directly. */
export function createViewModifierEventListener(modifiers: ModifierConfig[]): GlobalEvent {
  const listeners: Record<string, (args: never) => void> = {};
  for (const modifier of modifiers) {
    if (modifier.eventListener) listeners[modifier.$type] = modifier.eventListener;
  }
  return {
    onGlobalEvent: ({ nativeEvent }) => {
      for (const [name, params] of Object.entries(nativeEvent)) {
        const listener = listeners[name];
        if (listener) (listener as (args: unknown) => void)(params);
      }
    },
  };
}

export const isModifier = (value: unknown): value is ModifierConfig =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { $type?: unknown }).$type === 'string';

export const filterModifiers = (modifiers: unknown[]): ModifierConfig[] =>
  modifiers.filter(isModifier);

/** Every built-in returns a `ModifierConfig`, so the union collapses. */
export type BuiltInModifier = ModifierConfig;
export type ViewModifier = BuiltInModifier | ModifierConfig;

// --- layout / geometry ---

export const listSectionSpacing = (spacing: 'default' | 'compact' | number): ModifierConfig =>
  typeof spacing === 'number'
    ? createModifier('listSectionSpacing', { spacing: 'custom', value: spacing })
    : createModifier('listSectionSpacing', { spacing });

export const cornerRadius = (radius: number): ModifierConfig =>
  createModifier('cornerRadius', { radius });

export const shadow = (params: {
  radius: number;
  x?: number;
  y?: number;
  color?: Color;
}): ModifierConfig => createModifier('shadow', params);

export const matchedGeometryEffect = (id: string, namespaceId: string): ModifierConfig =>
  createModifier('matchedGeometryEffect', { id, namespaceId });

type FrameAlignment =
  | 'center'
  | 'leading'
  | 'trailing'
  | 'top'
  | 'bottom'
  | 'topLeading'
  | 'topTrailing'
  | 'bottomLeading'
  | 'bottomTrailing';

export const frame = (params: {
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  idealWidth?: number;
  idealHeight?: number;
  alignment?: FrameAlignment;
}): ModifierConfig => createModifier('frame', params);

export const containerRelativeFrame = (params: {
  axes: 'horizontal' | 'vertical' | 'both';
  count?: number;
  span?: number;
  spacing?: number;
  alignment?: FrameAlignment;
}): ModifierConfig => createModifier('containerRelativeFrame', params);

export const padding = (params?: {
  top?: number;
  bottom?: number;
  leading?: number;
  trailing?: number;
  horizontal?: number;
  vertical?: number;
  all?: number;
}): ModifierConfig => createModifier('padding', params);

export const fixedSize = (params?: { horizontal?: boolean; vertical?: boolean }): ModifierConfig =>
  createModifier('fixedSize', params);

export const ignoreSafeArea = (params?: {
  regions?: 'all' | 'container' | 'keyboard';
  edges?: 'all' | 'top' | 'bottom' | 'leading' | 'trailing' | 'horizontal' | 'vertical';
}): ModifierConfig => createModifier('ignoreSafeArea', params);

// --- events ---

export const onTapGesture = (handler: () => void): ModifierConfig =>
  createModifierWithEventListener('onTapGesture', handler);

export const onLongPressGesture = (handler: () => void, minimumDuration?: number): ModifierConfig =>
  createModifierWithEventListener('onLongPressGesture', handler, {
    minimumDuration: minimumDuration ?? 0.5,
  });

export const onAppear = (handler: () => void): ModifierConfig =>
  createModifierWithEventListener('onAppear', handler);

export const onDisappear = (handler: () => void): ModifierConfig =>
  createModifierWithEventListener('onDisappear', handler);

/** No native `completeRefresh` handshake in node: the listener just awaits
 *  the handler. */
export const refreshable = (handler: () => Promise<void>): ModifierConfig =>
  createModifierWithEventListener('refreshable', async () => {
    await handler();
  });

// --- appearance ---

export const opacity = (value: number): ModifierConfig => createModifier('opacity', { value });

type ClipShape = 'rectangle' | 'circle' | 'capsule' | 'ellipse' | 'roundedRectangle';

export const clipShape = (shape: ClipShape, cornerRadius?: number): ModifierConfig =>
  createModifier('clipShape', { shape, cornerRadius });

export const border = (params: { color: Color; width?: number }): ModifierConfig =>
  createModifier('border', params);

export const scaleEffect = (scale: number | { x: number; y: number }): ModifierConfig =>
  createModifier('scaleEffect', typeof scale === 'number' ? { x: scale, y: scale } : scale);

export const rotationEffect = (angle: number): ModifierConfig =>
  createModifier('rotationEffect', { angle });

export const rotation3DEffect = (params: {
  angle: number;
  axis?: { x?: number; y?: number; z?: number };
  perspective?: number;
}): ModifierConfig =>
  createModifier('rotation3DEffect', {
    angle: params.angle,
    axisX: params.axis?.x ?? 0,
    axisY: params.axis?.y ?? 0,
    axisZ: params.axis?.z ?? 0,
    perspective: params.perspective ?? 1,
  });

export const offset = (params: { x?: number; y?: number }): ModifierConfig =>
  createModifier('offset', params);

/** @deprecated Use `foregroundStyle` (kept because the real index exports it). */
export const foregroundColor = (color: Color): ModifierConfig =>
  createModifier('foregroundColor', { color });

export const foregroundStyle = (
  style:
    | Color
    | { type: 'color'; color: Color }
    | {
        type: 'hierarchical';
        style: 'primary' | 'secondary' | 'tertiary' | 'quaternary' | 'quinary';
      }
    | {
        type: 'linearGradient';
        colors: Color[];
        startPoint: { x: number; y: number };
        endPoint: { x: number; y: number };
      }
    | {
        type: 'radialGradient';
        colors: Color[];
        center: { x: number; y: number };
        startRadius: number;
        endRadius: number;
      }
    | { type: 'angularGradient'; colors: Color[]; center: { x: number; y: number } },
): ModifierConfig => {
  if (style == null || typeof style !== 'object' || !('type' in style)) {
    return createModifier('foregroundStyle', { styleType: 'color', color: style });
  }
  if (style.type === 'hierarchical') {
    return createModifier('foregroundStyle', {
      styleType: 'hierarchical',
      hierarchicalStyle: style.style,
    });
  }
  const { type, ...rest } = style;
  return createModifier('foregroundStyle', { styleType: type, ...rest });
};

export const bold = (): ModifierConfig => createModifier('bold', {});
export const italic = (): ModifierConfig => createModifier('italic', {});
export const monospacedDigit = (): ModifierConfig => createModifier('monospacedDigit', {});
export const tint = (color: Color): ModifierConfig => createModifier('tint', { color });
export const hidden = (hidden: boolean = true): ModifierConfig =>
  createModifier('hidden', { hidden });
export const disabled = (disabled: boolean = true): ModifierConfig =>
  createModifier('disabled', { disabled });
export const zIndex = (index: number): ModifierConfig => createModifier('zIndex', { index });
export const blur = (radius: number): ModifierConfig => createModifier('blur', { radius });
export const brightness = (amount: number): ModifierConfig =>
  createModifier('brightness', { amount });
export const contrast = (amount: number): ModifierConfig => createModifier('contrast', { amount });
export const saturation = (amount: number): ModifierConfig =>
  createModifier('saturation', { amount });
export const hueRotation = (angle: number): ModifierConfig =>
  createModifier('hueRotation', { angle });
export const colorInvert = (inverted: boolean = true): ModifierConfig =>
  createModifier('colorInvert', { inverted });
export const grayscale = (amount: number): ModifierConfig =>
  createModifier('grayscale', { amount });

// --- control styles ---

export const buttonStyle = (
  style:
    | 'automatic'
    | 'bordered'
    | 'borderedProminent'
    | 'borderless'
    | 'glass'
    | 'glassProminent'
    | 'plain',
): ModifierConfig => createModifier('buttonStyle', { style });

export const toggleStyle = (style: 'automatic' | 'switch' | 'button'): ModifierConfig =>
  createModifier('toggleStyle', { style });

export const controlSize = (
  size: 'mini' | 'small' | 'regular' | 'large' | 'extraLarge',
): ModifierConfig => createModifier('controlSize', { size });

export const labelStyle = (
  style: 'automatic' | 'iconOnly' | 'titleAndIcon' | 'titleOnly',
): ModifierConfig => createModifier('labelStyle', { style });

export const labelsHidden = (): ModifierConfig => createModifier('labelsHidden', {});

export const textFieldStyle = (style: 'automatic' | 'plain' | 'roundedBorder'): ModifierConfig =>
  createModifier('textFieldStyle', { style });

// --- scrolling ---

export const scrollDismissesKeyboard = (
  mode: 'automatic' | 'never' | 'interactively' | 'immediately',
): ModifierConfig => createModifier('scrollDismissesKeyboard', { mode });

export const scrollDisabled = (disabled: boolean = true): ModifierConfig =>
  createModifier('scrollDisabled', { disabled });

type UnitPointValue =
  | 'zero'
  | 'topLeading'
  | 'top'
  | 'topTrailing'
  | 'leading'
  | 'center'
  | 'trailing'
  | 'bottomLeading'
  | 'bottom'
  | 'bottomTrailing';

export const defaultScrollAnchor = (anchor: UnitPointValue | null): ModifierConfig =>
  createModifier('defaultScrollAnchor', { anchor });

export const defaultScrollAnchorForRole = (
  anchor: UnitPointValue | null,
  role: 'initialOffset' | 'sizeChanges' | 'alignment',
): ModifierConfig => createModifier('defaultScrollAnchorForRole', { anchor, role });

export const scrollTargetBehavior = (behavior: 'paging' | 'viewAligned'): ModifierConfig =>
  createModifier('scrollTargetBehavior', { behavior });

export const scrollTargetLayout = (): ModifierConfig => createModifier('scrollTargetLayout', {});

export const scrollContentBackground = (
  visible: 'automatic' | 'visible' | 'hidden',
): ModifierConfig => createModifier('scrollContentBackground', { visible });

// --- lists ---

export const moveDisabled = (disabled: boolean = true): ModifierConfig =>
  createModifier('moveDisabled', { disabled });

export const deleteDisabled = (disabled: boolean = true): ModifierConfig =>
  createModifier('deleteDisabled', { disabled });

export const listRowBackground = (color: Color): ModifierConfig =>
  createModifier('listRowBackground', { color });

export const listRowSeparator = (
  visibility: 'automatic' | 'visible' | 'hidden',
  edges?: 'all' | 'top' | 'bottom',
): ModifierConfig => createModifier('listRowSeparator', { visibility, edges });

export const listRowInsets = (params: {
  top?: number;
  leading?: number;
  bottom?: number;
  trailing?: number;
}): ModifierConfig => createModifier('listRowInsets', params);

export const listSectionMargins = (params?: {
  length?: number;
  edges?: 'all' | 'top' | 'bottom' | 'leading' | 'trailing' | 'horizontal' | 'vertical';
}): ModifierConfig => createModifier('listSectionMargins', params);

export type ListStyle = 'automatic' | 'plain' | 'inset' | 'insetGrouped' | 'grouped' | 'sidebar';

export const listStyle = (style: ListStyle): ModifierConfig =>
  createModifier('listStyle', { style });

export const headerProminence = (prominence: 'standard' | 'increased'): ModifierConfig =>
  createModifier('headerProminence', { prominence });

export const badgeProminence = (
  badgeType: 'standard' | 'increased' | 'decreased',
): ModifierConfig => createModifier('badgeProminence', { badgeType });

export const badge = (value?: string): ModifierConfig => createModifier('badge', { value });

export const menuActionDismissBehavior = (
  behavior: 'automatic' | 'disabled' | 'enabled',
): ModifierConfig => createModifier('menuActionDismissBehavior', { behavior });

// --- accessibility / layout priority ---

export const accessibilityLabel = (label: string): ModifierConfig =>
  createModifier('accessibilityLabel', { label });

export const accessibilityHint = (hint: string): ModifierConfig =>
  createModifier('accessibilityHint', { hint });

export const accessibilityValue = (value: string): ModifierConfig =>
  createModifier('accessibilityValue', { value });

export const layoutPriority = (priority: number): ModifierConfig =>
  createModifier('layoutPriority', { priority });

// --- masks / overlays / glass ---

export const mask = (shape: ClipShape, cornerRadius?: number): ModifierConfig =>
  createModifier('mask', { shape, cornerRadius });

type OverlayAlignment = 'center' | 'top' | 'bottom' | 'leading' | 'trailing';

export const overlay = (params: { color?: Color; alignment?: OverlayAlignment }): ModifierConfig =>
  createModifier('overlay', params);

export const backgroundOverlay = (params: {
  color?: Color;
  alignment?: OverlayAlignment;
}): ModifierConfig => createModifier('backgroundOverlay', params);

export const aspectRatio = (params: {
  ratio?: number;
  contentMode?: 'fit' | 'fill';
}): ModifierConfig => createModifier('aspectRatio', params);

export const clipped = (clipped: boolean = true): ModifierConfig =>
  createModifier('clipped', { clipped });

export const glassEffect = (params?: {
  glass?: { variant: 'regular' | 'clear' | 'identity'; interactive?: boolean; tint?: Color };
  shape?: 'circle' | 'capsule' | 'rectangle' | 'ellipse' | 'roundedRectangle';
  cornerRadius?: number;
}): ModifierConfig => createModifier('glassEffect', params);

export const glassEffectId = (id: string, namespaceId: string): ModifierConfig =>
  createModifier('glassEffectId', { id, namespaceId });

export const luminanceToAlpha = (): ModifierConfig => createModifier('luminanceToAlpha', {});

// --- text ---

export const truncationMode = (mode: 'head' | 'middle' | 'tail'): ModifierConfig =>
  createModifier('truncationMode', { mode });

export const allowsTightening = (value: boolean): ModifierConfig =>
  createModifier('allowsTightening', { value });

export const kerning = (value?: number): ModifierConfig => createModifier('kerning', { value });

export const textCase = (value: 'lowercase' | 'uppercase'): ModifierConfig =>
  createModifier('textCase', { value });

type LinePattern = 'solid' | 'dash' | 'dot' | 'dashDot' | 'dashDotDot';

export const underline = (params: {
  isActive: boolean;
  pattern: LinePattern;
  color?: Color;
}): ModifierConfig => createModifier('underline', params);

export const strikethrough = (params: {
  isActive: boolean;
  pattern: LinePattern;
  color?: Color;
}): ModifierConfig => createModifier('strikethrough', params);

export const multilineTextAlignment = (
  alignment: 'center' | 'leading' | 'trailing',
): ModifierConfig => createModifier('multilineTextAlignment', { alignment });

export const textSelection = (value: boolean): ModifierConfig =>
  createModifier('textSelection', { value });

export const lineSpacing = (value: number): ModifierConfig =>
  createModifier('lineSpacing', { value });

export function lineLimit(): ModifierConfig;
export function lineLimit(limit: number, options?: { reservesSpace?: boolean }): ModifierConfig;
export function lineLimit(range: { min: number; max: number }): ModifierConfig;
export function lineLimit(
  limitOrRange?: number | { min: number; max: number },
  options?: { reservesSpace?: boolean },
): ModifierConfig {
  if (typeof limitOrRange === 'object' && limitOrRange !== null) {
    return createModifier('lineLimit', { min: limitOrRange.min, max: limitOrRange.max });
  }
  return createModifier('lineLimit', {
    limit: limitOrRange,
    reservesSpace: options?.reservesSpace,
  });
}

export const font = (params: {
  family?: string;
  size?: number;
  weight?:
    | 'ultraLight'
    | 'thin'
    | 'light'
    | 'regular'
    | 'medium'
    | 'semibold'
    | 'bold'
    | 'heavy'
    | 'black';
  design?: 'default' | 'rounded' | 'serif' | 'monospaced';
}): ModifierConfig => createModifier('font', params);

export const contentTransition = (
  transitionType: 'numericText' | 'identity' | 'opacity' | 'interpolate',
  params?: { countsDown?: boolean },
): ModifierConfig =>
  createModifier('contentTransition', { transitionType, countsDown: params?.countsDown });

// --- grid ---

export const gridCellUnsizedAxes = (axes?: 'horizontal' | 'vertical'): ModifierConfig =>
  createModifier('gridCellUnsizedAxes', { axes });

export const gridCellColumns = (count?: number): ModifierConfig =>
  createModifier('gridCellColumns', { count });

export const gridColumnAlignment = (
  alignment?: 'leading' | 'center' | 'trailing',
): ModifierConfig => createModifier('gridColumnAlignment', { alignment });

export const gridCellAnchor = (
  anchor:
    | { type: 'preset'; anchor: UnitPointValue }
    | { type: 'custom'; points: { x: number; y: number } },
): ModifierConfig => createModifier('gridCellAnchor', anchor);

// --- text input ---

export const submitLabel = (
  submitLabel:
    | 'continue'
    | 'done'
    | 'go'
    | 'join'
    | 'next'
    | 'return'
    | 'route'
    | 'search'
    | 'send',
): ModifierConfig => createModifier('submitLabel', { submitLabel });

export const keyboardType = (
  keyboardType:
    | 'default'
    | 'email-address'
    | 'numeric'
    | 'phone-pad'
    | 'ascii-capable'
    | 'numbers-and-punctuation'
    | 'url'
    | 'name-phone-pad'
    | 'decimal-pad'
    | 'twitter'
    | 'web-search'
    | 'ascii-capable-number-pad',
): ModifierConfig => createModifier('keyboardType', { keyboardType });

export const autocorrectionDisabled = (disabled: boolean = true): ModifierConfig =>
  createModifier('autocorrectionDisabled', { disabled });

export const onSubmit = (handler: () => void): ModifierConfig =>
  createModifierWithEventListener('onSubmit', handler);

export const textInputAutocapitalization = (
  autocapitalization: 'never' | 'words' | 'sentences' | 'characters',
): ModifierConfig => createModifier('textInputAutocapitalization', { autocapitalization });

export const textContentType = (
  textContentType:
    | 'URL'
    | 'namePrefix'
    | 'name'
    | 'nameSuffix'
    | 'givenName'
    | 'middleName'
    | 'familyName'
    | 'nickname'
    | 'organizationName'
    | 'jobTitle'
    | 'location'
    | 'fullStreetAddress'
    | 'streetAddressLine1'
    | 'streetAddressLine2'
    | 'addressCity'
    | 'addressCityAndState'
    | 'addressState'
    | 'postalCode'
    | 'sublocality'
    | 'countryName'
    | 'username'
    | 'password'
    | 'newPassword'
    | 'oneTimeCode'
    | 'emailAddress'
    | 'telephoneNumber'
    | 'cellularEID'
    | 'cellularIMEI'
    | 'creditCardNumber'
    | 'creditCardExpiration'
    | 'creditCardExpirationMonth'
    | 'creditCardExpirationYear'
    | 'creditCardSecurityCode'
    | 'creditCardType'
    | 'creditCardName'
    | 'creditCardGivenName'
    | 'creditCardMiddleName'
    | 'creditCardFamilyName'
    | 'birthdate'
    | 'birthdateDay'
    | 'birthdateMonth'
    | 'birthdateYear'
    | 'dateTime'
    | 'flightNumber'
    | 'shipmentTrackingNumber',
): ModifierConfig => createModifier('textContentType', { textContentType });

// --- image ---

export const resizable = (
  capInsets?: { top?: number; bottom?: number; leading?: number; trailing?: number },
  resizingMode?: 'stretch' | 'tile',
): ModifierConfig => createModifier('resizable', { ...capInsets, resizingMode });

// --- shapes (modifiers/shapes/index.ts) ---

export const shapes = {
  roundedRectangle: (params: {
    cornerRadius?: number;
    roundedCornerStyle?: 'continuous' | 'circular';
    cornerSize?: { width: number; height: number };
  }) => ({
    cornerRadius: params.cornerRadius,
    roundedCornerStyle: params.roundedCornerStyle,
    cornerSize: params.cornerSize,
    shape: 'roundedRectangle',
  }),
  capsule: (params?: { roundedCornerStyle?: 'continuous' | 'circular' }) => ({
    roundedCornerStyle: params?.roundedCornerStyle,
    shape: 'capsule',
  }),
  rectangle: () => ({ shape: 'rectangle' }),
  ellipse: () => ({ shape: 'ellipse' }),
  circle: () => ({ shape: 'circle' }),
};

export type Shape =
  | ReturnType<typeof shapes.roundedRectangle>
  | ReturnType<typeof shapes.capsule>
  | ReturnType<typeof shapes.rectangle>
  | ReturnType<typeof shapes.ellipse>
  | ReturnType<typeof shapes.circle>;

export const background = (color: Color, shape?: Shape): ModifierConfig =>
  createModifier('background', { color, ...shape });

export const containerShape = (shape: Shape): ModifierConfig =>
  createModifier('containerShape', shape);

export const contentShape = (shape: Shape): ModifierConfig => createModifier('contentShape', shape);

// --- tag / styles ---

export const tag = (tag: string | number): ModifierConfig => createModifier('tag', { tag });

export type PickerStyleType =
  | 'automatic'
  | 'inline'
  | 'menu'
  | 'navigationLink'
  | 'palette'
  | 'segmented'
  | 'wheel';
export const pickerStyle = (style: PickerStyleType): ModifierConfig =>
  createModifier('pickerStyle', { style });

export type DatePickerStyleType = 'automatic' | 'compact' | 'graphical' | 'wheel';
export const datePickerStyle = (style: DatePickerStyleType): ModifierConfig =>
  createModifier('datePickerStyle', { style });

export type ProgressViewStyleType = 'automatic' | 'linear' | 'circular';
export const progressViewStyle = (style: ProgressViewStyleType): ModifierConfig =>
  createModifier('progressViewStyle', { style });

export type GaugeStyleType =
  | 'automatic'
  | 'circular'
  | 'circularCapacity'
  | 'linear'
  | 'linearCapacity';
export const gaugeStyle = (style: GaugeStyleType): ModifierConfig =>
  createModifier('gaugeStyle', { style });

// --- presentation (modifiers/presentationModifiers.ts) ---

export type PresentationDetent = 'medium' | 'large' | { fraction: number } | { height: number };

export const presentationDetents = (
  detents: PresentationDetent[],
  options?: {
    selection?: PresentationDetent;
    onSelectionChange?: (detent: PresentationDetent) => void;
  },
): ModifierConfig => {
  const params = { detents, selection: options?.selection };
  const { onSelectionChange } = options ?? {};
  if (onSelectionChange) {
    return createModifierWithEventListener(
      'presentationDetents',
      (args: { detent: PresentationDetent }) => {
        onSelectionChange(args.detent);
      },
      params,
    );
  }
  return createModifier('presentationDetents', params);
};

export const presentationDragIndicator = (
  visibility: 'automatic' | 'visible' | 'hidden',
): ModifierConfig => createModifier('presentationDragIndicator', { visibility });

export type PresentationBackgroundInteractionType =
  | 'automatic'
  | 'enabled'
  | 'disabled'
  | { type: 'enabledUpThrough'; detent: PresentationDetent };

export const presentationBackgroundInteraction = (
  interaction: PresentationBackgroundInteractionType,
): ModifierConfig =>
  typeof interaction === 'string'
    ? createModifier('presentationBackgroundInteraction', { interactionType: interaction })
    : createModifier('presentationBackgroundInteraction', {
        interactionType: 'enabledUpThrough',
        detent: interaction.detent,
      });

export const interactiveDismissDisabled = (isDisabled: boolean = true): ModifierConfig =>
  createModifier('interactiveDismissDisabled', { isDisabled });

// --- environment / widgets ---

export type EnvironmentConfig =
  | { key: 'editMode'; value: 'active' | 'inactive' | 'transient' }
  | { key: 'colorScheme'; value: 'light' | 'dark' }
  | { key: 'locale'; value: string }
  | { key: 'timeZone'; value: string };

export function environment(config: EnvironmentConfig): ModifierConfig;
export function environment(key: EnvironmentConfig['key'], value: string): ModifierConfig;
export function environment(
  configOrKey: EnvironmentConfig | string,
  value?: string,
): ModifierConfig {
  if (typeof configOrKey === 'string') {
    return createModifier('environment', { key: configOrKey, value });
  }
  return createModifier('environment', configOrKey);
}

export const widgetAccentedRenderingMode = (
  renderingMode: 'fullColor' | 'accented' | 'desaturated' | 'accentedDesaturated',
): ModifierConfig => createModifier('widgetAccentedRenderingMode', { renderingMode });

export const widgetURL = (url: string): ModifierConfig => createModifier('widgetURL', { url });

// --- animation (modifiers/animation/*) ---

export type AnimationObject = {
  type:
    | 'easeInOut'
    | 'easeIn'
    | 'easeOut'
    | 'linear'
    | 'spring'
    | 'interpolatingSpring'
    | 'default';
  duration?: number;
  response?: number;
  dampingFraction?: number;
  blendDuration?: number;
  bounce?: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  initialVelocity?: number;
  delay?: number;
  repeatCount?: number;
  autoreverses?: boolean;
};

export type TimingAnimationParams = { duration?: number };
export type SpringAnimationParams = {
  response?: number;
  dampingFraction?: number;
  blendDuration?: number;
  duration?: number;
  bounce?: number;
};
export type InterpolatingSpringAnimationParams = {
  duration?: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  initialVelocity?: number;
  bounce?: number;
};

const VALUE_SYMBOL = Symbol('value');

export type ChainableAnimationType = {
  delay: (delay: number) => ChainableAnimationType;
  repeat: (params: { repeatCount: number; autoreverses?: boolean }) => ChainableAnimationType;
  [VALUE_SYMBOL]: () => AnimationObject;
};

/** The builder is the one non-plain object in the real API; `animation()`
 *  unwraps it to its `AnimationObject` before anything reaches a host. */
function ChainableAnimation(animation: AnimationObject): ChainableAnimationType {
  let current: AnimationObject = animation;
  return {
    delay: (delay) => {
      current = { ...current, delay };
      return ChainableAnimation(current);
    },
    repeat: (params) => {
      current = { ...current, ...params };
      return ChainableAnimation(current);
    },
    [VALUE_SYMBOL]: () => current,
  };
}

export const Animation = {
  easeInOut: (params?: TimingAnimationParams): ChainableAnimationType =>
    ChainableAnimation({ type: 'easeInOut', duration: params?.duration }),
  easeIn: (params?: TimingAnimationParams): ChainableAnimationType =>
    ChainableAnimation({ type: 'easeIn', duration: params?.duration }),
  easeOut: (params?: TimingAnimationParams): ChainableAnimationType =>
    ChainableAnimation({ type: 'easeOut', duration: params?.duration }),
  linear: (params?: TimingAnimationParams): ChainableAnimationType =>
    ChainableAnimation({ type: 'linear', duration: params?.duration }),
  spring: (params?: SpringAnimationParams): ChainableAnimationType =>
    ChainableAnimation({
      type: 'spring',
      response: params?.response,
      dampingFraction: params?.dampingFraction,
      blendDuration: params?.blendDuration,
      duration: params?.duration,
      bounce: params?.bounce,
    }),
  interpolatingSpring: (params?: InterpolatingSpringAnimationParams): ChainableAnimationType =>
    ChainableAnimation({
      type: 'interpolatingSpring',
      mass: params?.mass,
      stiffness: params?.stiffness,
      damping: params?.damping,
      initialVelocity: params?.initialVelocity,
      duration: params?.duration,
      bounce: params?.bounce,
    }),
  default: ChainableAnimation({ type: 'default' }),
};

export const animation = (
  animationObject: ChainableAnimationType,
  animatedValue: number | boolean,
): ModifierConfig =>
  createModifier('animation', { animation: animationObject[VALUE_SYMBOL](), animatedValue });

// =============================================================================
// Serialisation guard + host element factory
// =============================================================================

type AnyProps = Record<string, unknown> & { children?: ReactNode };

/** Same marker rn-stub puts on its Animated nodes (rn-stub.tsx `ANIMATED`). */
const ANIMATED = Symbol.for('roadopia.rn-stub.animated');

function isAnimated(v: unknown): v is { __value(): number } {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[ANIMATED] === true;
}

/** Reduce one prop value to something JSON.stringify accepts (see header).
 *  `path` holds the objects currently being walked, so a cycle is cut at the
 *  back-reference rather than recursed into. */
function plain(v: unknown, path: Set<object>): unknown {
  if (v === null || v === undefined) return v;
  switch (typeof v) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'function':
      return v;
    case 'object':
      break;
    default:
      return undefined; // symbol, bigint
  }
  if (isAnimated(v)) return v.__value();
  if (v instanceof Date) return v.toISOString();
  if (isValidElement(v)) return undefined;
  const o = v as object;
  if (path.has(o)) return undefined; // cycle
  if (Array.isArray(o)) {
    path.add(o);
    const out = o.map((x) => plain(x, path));
    path.delete(o);
    return out;
  }
  const proto: unknown = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) return undefined; // class instance
  path.add(o);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    const p = plain(x, path);
    if (p !== undefined) out[k] = p;
  }
  path.delete(o);
  return out;
}

/** A prop value that is really content: one element, or a list of them. */
function isElementProp(v: unknown): v is ReactNode {
  return isValidElement(v) || (Array.isArray(v) && v.some((x) => isValidElement(x)));
}

const TEXT = 'expo-ui-text';
const SLOT = 'expo-ui-slot';

function assertNoBareText(tag: string, children: ReactNode): void {
  // Mirror RN's invariant: raw strings/numbers may only sit inside <Text>.
  // On device this crashes ("Text strings must be rendered within a <Text>");
  // making it throw here turns that crash class into a CI failure.
  if (tag === TEXT) return;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'string' && child.trim() !== '') {
      throw new Error(`RN text invariant: bare string "${child}" inside <${tag}>`);
    }
    if (typeof child === 'number') {
      throw new Error(`RN text invariant: bare number ${child} inside <${tag}>`);
    }
  }
}

/** Build the host element: plain props only; element-valued props become
 *  `expo-ui-slot` children named after the prop; `ref` never reaches a host. */
function renderHost(tag: string, props: AnyProps): ReactElement {
  const { children, ...rest } = props;
  delete rest['ref'];
  assertNoBareText(tag, children);
  const slots: ReactElement[] = [];
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(rest)) {
    if (isElementProp(value)) {
      assertNoBareText(SLOT, value);
      slots.push(createElement(SLOT, { key: name, name }, value));
      continue;
    }
    const p = plain(value, new Set());
    if (p !== undefined) out[name] = p;
  }
  return createElement(tag, out, ...slots, children);
}

function host<P extends AnyProps>(tag: string): (props: P) => ReactElement {
  return function StubHost(props: P): ReactElement {
    return renderHost(tag, props);
  };
}

type SlotComponent = (props: { children?: ReactNode }) => ReactElement;

/** The real `Slot` (SlotView.tsx) is internal; compound parts such as
 *  `Alert.Trigger` render through this with the native slot name. */
function slotComponent(name: string): SlotComponent {
  return function StubSlot(props: { children?: ReactNode }): ReactElement {
    assertNoBareText(SLOT, props.children);
    return createElement(SLOT, { name }, props.children);
  };
}

/** Presented-state gating (see header): everything when `presented`, else
 *  only the children whose component is in `keep`. */
function visibleChildren(
  children: ReactNode,
  presented: boolean | undefined,
  keep: readonly SlotComponent[],
): ReactNode {
  if (presented === true) return children;
  return Children.toArray(children).filter(
    (c) => isValidElement(c) && keep.some((k) => c.type === k),
  );
}

// =============================================================================
// Test hooks
// =============================================================================

/** Node cannot lay SwiftUI out, so `Host.onLayoutContent` never fires on its
 *  own. A test that exercises a `matchContents` host sets the size it wants
 *  reported BEFORE rendering; every `Host` mounted afterwards fires
 *  `onLayoutContent` once with it. Restore with `__setLayoutContentSize(null)`
 *  in a finally/afterEach — it is module state shared by every test in the
 *  same file. */
let __layoutContentSize: { width: number; height: number } | null = null;

export function __setLayoutContentSize(size: { width: number; height: number } | null): void {
  __layoutContentSize = size;
}

// =============================================================================
// Components (mirrors src/swift-ui/index.tsx, in its export order)
// =============================================================================

// --- AccessoryWidgetBackground ---

export type AccessoryWidgetBackgroundProps = CommonViewModifierProps;
export const AccessoryWidgetBackground = host<AccessoryWidgetBackgroundProps>(
  'expo-ui-accessorywidgetbackground',
);

// --- Alert ---

export type AlertProps = {
  children: ReactNode;
  title: string;
  isPresented?: boolean;
  onIsPresentedChange?: (isPresented: boolean) => void;
} & CommonViewModifierProps;

const AlertTrigger = slotComponent('trigger');
const AlertActions = slotComponent('actions');
const AlertMessage = slotComponent('message');

function Alert(props: AlertProps): ReactElement {
  const { children, ...rest } = props;
  return renderHost('expo-ui-alert', {
    ...rest,
    children: visibleChildren(children, props.isPresented, [AlertTrigger]),
  });
}
Alert.Trigger = AlertTrigger;
Alert.Actions = AlertActions;
Alert.Message = AlertMessage;
export { Alert };

// --- BottomSheet ---

export type BottomSheetProps = {
  children: ReactNode;
  isPresented: boolean;
  onIsPresentedChange: (isPresented: boolean) => void;
  fitToContents?: boolean;
} & CommonViewModifierProps;

/** Children render ONLY while presented (see header); `isPresented` and
 *  `onIsPresentedChange` are forwarded so a test can read one and call the
 *  other. */
function BottomSheet(props: BottomSheetProps): ReactElement {
  const { children, ...rest } = props;
  return renderHost('expo-ui-bottomsheet', {
    ...rest,
    children: props.isPresented ? children : null,
  });
}
export { BottomSheet };

// --- Button ---

export type ButtonRole = 'default' | 'cancel' | 'destructive';

export type ButtonProps = {
  onPress?: () => void;
  systemImage?: SFSymbol;
  role?: ButtonRole;
  /** The copy of a simple text button. Serialised as a prop, so a substring
   *  test finds it; the real Button has NO string-children form. */
  label?: string;
  children?: ReactElement | ReactElement[];
  target?: string;
} & CommonViewModifierProps;

export function Button(props: ButtonProps): ReactElement {
  return renderHost('expo-ui-button', props);
}

// --- Chart ---

export type ChartType = 'line' | 'point' | 'bar' | 'area' | 'pie' | 'rectangle';
export type PointStyle = 'circle' | 'square' | 'diamond';
export type ChartDataPoint = { x: string | number; y: number; color?: ColorValue };
export type LineChartStyle = {
  dashArray?: number[];
  width?: number;
  pointStyle?: PointStyle;
  pointSize?: number;
  color?: ColorValue;
};
export type AreaChartStyle = { color?: ColorValue };
export type BarChartStyle = { cornerRadius?: number; width?: number };
export type PieChartStyle = { innerRadius?: number; angularInset?: number };
export type PointChartStyle = { pointStyle?: PointStyle; pointSize?: number };
export type RectangleChartStyle = { color?: ColorValue; cornerRadius?: number };
export type RuleChartStyle = { color?: ColorValue; lineWidth?: number; dashArray?: number[] };

export type ChartProps = {
  data: ChartDataPoint[];
  type?: ChartType;
  showGrid?: boolean;
  animate?: boolean;
  showLegend?: boolean;
  referenceLines?: ChartDataPoint[];
  lineStyle?: LineChartStyle;
  pointStyle?: PointChartStyle;
  areaStyle?: AreaChartStyle;
  barStyle?: BarChartStyle;
  pieStyle?: PieChartStyle;
  rectangleStyle?: RectangleChartStyle;
  ruleStyle?: RuleChartStyle;
} & CommonViewModifierProps;

export function Chart(props: ChartProps & { style?: unknown }): ReactElement {
  return renderHost('expo-ui-chart', props);
}

// --- ColorPicker ---

export type ColorPickerProps = {
  selection: string | null;
  label?: string;
  onSelectionChange?: (value: string) => void;
  supportsOpacity?: boolean;
} & CommonViewModifierProps;

export const ColorPicker = host<ColorPickerProps>('expo-ui-colorpicker');

// --- ContentUnavailableView ---

export type ContentUnavailableViewProps = {
  title?: string;
  systemImage?: SFSymbol;
  description?: string;
} & CommonViewModifierProps;

export const ContentUnavailableView = host<ContentUnavailableViewProps>(
  'expo-ui-contentunavailableview',
);

// --- ConfirmationDialog ---

export type ConfirmationDialogProps = {
  children: ReactNode;
  title: string;
  isPresented?: boolean;
  onIsPresentedChange?: (isPresented: boolean) => void;
  titleVisibility?: 'automatic' | 'visible' | 'hidden';
} & CommonViewModifierProps;

const ConfirmationDialogTrigger = slotComponent('trigger');
const ConfirmationDialogActions = slotComponent('actions');
const ConfirmationDialogMessage = slotComponent('message');

function ConfirmationDialog(props: ConfirmationDialogProps): ReactElement {
  const { children, ...rest } = props;
  return renderHost('expo-ui-confirmationdialog', {
    ...rest,
    children: visibleChildren(children, props.isPresented, [ConfirmationDialogTrigger]),
  });
}
ConfirmationDialog.Trigger = ConfirmationDialogTrigger;
ConfirmationDialog.Actions = ConfirmationDialogActions;
ConfirmationDialog.Message = ConfirmationDialogMessage;
export { ConfirmationDialog };

// --- ControlGroup ---

export type ControlGroupProps = {
  label?: string | ReactNode;
  systemImage?: SFSymbol;
  children: ReactNode;
} & CommonViewModifierProps;

export const ControlGroup = host<ControlGroupProps>('expo-ui-controlgroup');

// --- ContextMenu ---

export type ContextMenuProps = { children: ReactNode } & CommonViewModifierProps;

/** @deprecated The real keeps this type for the removed Submenu API. */
export type SubmenuProps = {
  button: ReactElement<ButtonProps>;
  children: ReactNode;
};

/** The real index re-exports these three at the TOP level as well as on
 *  `ContextMenu.*`; both spellings resolve here too. */
export const Items = slotComponent('items');
export const Trigger = slotComponent('trigger');
export const Preview = slotComponent('preview');

function ContextMenu(props: ContextMenuProps): ReactElement {
  return renderHost('expo-ui-contextmenu', props);
}
ContextMenu.Trigger = Trigger;
ContextMenu.Preview = Preview;
ContextMenu.Items = Items;
export { ContextMenu };

// --- DatePicker ---

export type DatePickerComponent = 'date' | 'hourAndMinute';
export type DateRange = { start?: Date; end?: Date };

export type DatePickerProps = {
  title?: string;
  selection?: Date;
  range?: DateRange;
  displayedComponents?: DatePickerComponent[];
  onDateChange?: (date: Date) => void;
  children?: ReactNode;
} & CommonViewModifierProps;

/** Dates are forwarded as ISO strings, the shape the real hands native. */
export function DatePicker(props: DatePickerProps): ReactElement {
  const { selection, range, ...rest } = props;
  return renderHost('expo-ui-datepicker', {
    ...rest,
    selection: selection?.toISOString(),
    range: range ? { start: range.start?.toISOString(), end: range.end?.toISOString() } : undefined,
  });
}

// --- Divider ---

export type DividerProps = CommonViewModifierProps;
export const Divider = host<DividerProps>('expo-ui-divider');

// --- DisclosureGroup ---

export type DisclosureGroupProps = {
  label: string;
  children: ReactNode;
  isExpanded?: boolean;
  onIsExpandedChange?: (isExpanded: boolean) => void;
} & CommonViewModifierProps;

/** Content renders only while `isExpanded` (an uncontrolled group starts
 *  collapsed on device, so `undefined` hides it too). */
export function DisclosureGroup(props: DisclosureGroupProps): ReactElement {
  const { children, ...rest } = props;
  return renderHost('expo-ui-disclosuregroup', {
    ...rest,
    children: props.isExpanded === true ? children : null,
  });
}

// --- Form ---

export type FormProps = { children: ReactNode } & CommonViewModifierProps;
export const Form = host<FormProps>('expo-ui-form');

// --- Gauge ---

export type GaugeProps = {
  value: number;
  min?: number;
  max?: number;
  children?: ReactNode;
  currentValueLabel?: ReactNode;
  minimumValueLabel?: ReactNode;
  maximumValueLabel?: ReactNode;
} & CommonViewModifierProps;

export const Gauge = host<GaugeProps>('expo-ui-gauge');

// --- Host ---

export type HostProps = {
  matchContents?: boolean | { vertical?: boolean; horizontal?: boolean };
  useViewportSizeMeasurement?: boolean;
  onLayoutContent?: (event: { nativeEvent: { width: number; height: number } }) => void;
  colorScheme?: 'light' | 'dark';
  layoutDirection?: 'leftToRight' | 'rightToLeft';
  ignoreSafeArea?: 'all' | 'keyboard';
  children: ReactNode;
  style?: unknown;
} & CommonViewModifierProps;

export function Host(props: HostProps): ReactElement {
  // Latest handler in a ref so the mount-only effect below never re-fires
  // for an inline arrow (a handler that sets state would otherwise loop).
  const latest = useRef(props.onLayoutContent);
  latest.current = props.onLayoutContent;
  useEffect(() => {
    if (__layoutContentSize) latest.current?.({ nativeEvent: { ...__layoutContentSize } });
  }, []);
  return renderHost('expo-ui-host', props);
}

// --- Image ---

export type ImageProps = {
  systemName?: SFSymbol;
  uiImage?: string;
  size?: number;
  color?: ColorValue;
  variableValue?: number;
  onPress?: () => void;
} & CommonViewModifierProps;

export const Image = host<ImageProps>('expo-ui-image');

// --- Label ---

export type LabelProps = {
  title?: string;
  systemImage?: SFSymbol;
  icon?: ReactNode;
  /** @deprecated Use the `foregroundStyle` modifier. */
  color?: ColorValue;
} & CommonViewModifierProps;

export const Label = host<LabelProps>('expo-ui-label');

// --- LabeledContent ---

export type LabeledContentProps = {
  label?: string | ReactNode;
  children: ReactNode;
} & CommonViewModifierProps;

export const LabeledContent = host<LabeledContentProps>('expo-ui-labeledcontent');

// --- HStack / VStack / ZStack / Group ---

export type HStackProps = {
  children: ReactNode;
  spacing?: number;
  alignment?: 'top' | 'center' | 'bottom' | 'firstTextBaseline' | 'lastTextBaseline';
} & CommonViewModifierProps;
export const HStack = host<HStackProps>('expo-ui-hstack');

export type VStackProps = {
  children: ReactNode;
  alignment?: 'leading' | 'center' | 'trailing';
  spacing?: number;
} & CommonViewModifierProps;
export const VStack = host<VStackProps>('expo-ui-vstack');

export type ZStackProps = { children: ReactNode; alignment?: Alignment } & CommonViewModifierProps;
export const ZStack = host<ZStackProps>('expo-ui-zstack');

export type GroupProps = { children: ReactNode } & CommonViewModifierProps;
export const Group = host<GroupProps>('expo-ui-group');

// --- List ---

export type ListForEachProps = {
  children: ReactNode;
  onDelete?: (indices: number[]) => void;
  onMove?: (sourceIndices: number[], destination: number) => void;
} & CommonViewModifierProps;

export const ListForEach = host<ListForEachProps>('expo-ui-listforeach');

export type ListProps = {
  children: ReactNode;
  selection?: (string | number)[];
  onSelectionChange?: (selection: (string | number)[]) => void;
} & CommonViewModifierProps;

function List(props: ListProps): ReactElement {
  return renderHost('expo-ui-list', props);
}
List.ForEach = ListForEach;
export { List };

// --- Menu ---

export type MenuProps = {
  label: string | ReactNode;
  systemImage?: string;
  onPrimaryAction?: () => void;
  children: ReactNode;
} & CommonViewModifierProps;

/** Items render inline — there is no open state to gate on. */
export const Menu = host<MenuProps>('expo-ui-menu');

// --- Picker ---

type SelectionValueType = string | number | null;

export type PickerProps<T extends SelectionValueType = SelectionValueType> = {
  systemImage?: SFSymbol;
  label?: string | ReactNode;
  selection?: T;
  onSelectionChange?: (selection: T) => void;
  /** `Text` options carrying `tag()` modifiers; rendered as children. */
  children?: ReactNode;
} & CommonViewModifierProps;

export function Picker<T extends SelectionValueType>(props: PickerProps<T>): ReactElement {
  return renderHost('expo-ui-picker', props);
}

// --- ProgressView ---

export type ProgressViewProps = {
  value?: number | null;
  timerInterval?: ClosedRangeDate;
  countsDown?: boolean;
  children?: ReactNode;
} & CommonViewModifierProps;

export function ProgressView(props: ProgressViewProps): ReactElement {
  const { timerInterval, ...rest } = props;
  return renderHost('expo-ui-progressview', {
    ...rest,
    timerInterval: timerInterval
      ? { lower: timerInterval.lower.getTime(), upper: timerInterval.upper.getTime() }
      : undefined,
  });
}

// --- Section ---

export type SectionProps = {
  title?: string;
  footer?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  isExpanded?: boolean;
  onIsExpandedChange?: (isExpanded: boolean) => void;
} & CommonViewModifierProps;

/** `isExpanded` only means anything under the sidebar list style, so it is
 *  forwarded, not gated on. */
export const Section = host<SectionProps>('expo-ui-section');

// --- ShareLink ---

export type ShareLinkProps = {
  item?: string;
  getItemAsync?: () => Promise<string>;
  subject?: string;
  message?: string;
  preview?: { title: string; image: string };
  children?: ReactNode;
} & CommonViewModifierProps;

export const ShareLink = host<ShareLinkProps>('expo-ui-sharelink');

// --- Slider ---

export type SliderProps = {
  value?: number;
  step?: number;
  min?: number;
  max?: number;
  label?: ReactNode;
  minimumValueLabel?: ReactNode;
  maximumValueLabel?: ReactNode;
  onValueChange?: (value: number) => void;
  onEditingChanged?: (isEditing: boolean) => void;
} & CommonViewModifierProps;

export const Slider = host<SliderProps>('expo-ui-slider');

// --- Spacer ---

export type SpacerProps = { minLength?: number } & CommonViewModifierProps;
export const Spacer = host<SpacerProps>('expo-ui-spacer');

// --- Stepper ---

export type StepperProps = {
  label: string;
  value?: number;
  step?: number;
  min?: number;
  max?: number;
  onValueChange: (value: number) => void;
} & CommonViewModifierProps;

export const Stepper = host<StepperProps>('expo-ui-stepper');

// --- Text ---

export type TextDateStyle = 'timer' | 'relative' | 'offset' | 'date' | 'time';

export type TextProps = {
  children?: ReactNode;
  markdownEnabled?: boolean;
  date?: Date;
  dateStyle?: TextDateStyle;
  timerInterval?: ClosedRangeDate;
  countsDown?: boolean;
  pauseTime?: Date;
} & CommonViewModifierProps;

export function Text(props: TextProps): ReactElement | null {
  const { children, date, timerInterval, pauseTime, ...rest } = props;
  if (date != null || timerInterval != null) {
    return renderHost(TEXT, {
      ...rest,
      date: date?.getTime(),
      timerInterval: timerInterval
        ? { lower: timerInterval.lower.getTime(), upper: timerInterval.upper.getTime() }
        : undefined,
      pauseTime: pauseTime?.getTime(),
    });
  }
  if (children === undefined || children === null) return null;
  const pieces = Children.toArray(children).filter(
    (c): c is string | number | ReactElement =>
      typeof c === 'string' || typeof c === 'number' || (isValidElement(c) && c.type === Text),
  );
  if (pieces.length === 0) return null;
  const simple = pieces.every((c) => typeof c === 'string' || typeof c === 'number');
  return renderHost(TEXT, { ...rest, children: simple ? pieces.map(String).join('') : pieces });
}

// --- Toggle ---

export type ToggleProps = {
  isOn?: boolean;
  label?: string;
  systemImage?: SFSymbol;
  /** The real name — NOT `onValueChange`. Forwarded as-is so a test calls
   *  `props.onIsOnChange(true)`. */
  onIsOnChange?: (isOn: boolean) => void;
  children?: ReactNode;
} & CommonViewModifierProps;

export const Toggle = host<ToggleProps>('expo-ui-toggle');

// --- TextField / SecureField ---

export type TextFieldRef = {
  setText: (newText: string) => Promise<void>;
  focus: () => Promise<void>;
  blur: () => Promise<void>;
  setSelection: (start: number, end: number) => Promise<void>;
};

export type TextFieldProps = {
  ref?: Ref<TextFieldRef>;
  defaultValue?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onValueChange?: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  onSelectionChange?: ({ start, end }: { start: number; end: number }) => void;
  axis?: 'horizontal' | 'vertical';
} & CommonViewModifierProps;

/** Kept for import shape; the native event wrapper it describes is not
 *  modelled — the app's own callbacks are what the host forwards. */
export type NativeTextFieldProps = Omit<
  TextFieldProps,
  'onValueChange' | 'onFocusChange' | 'onSelectionChange'
>;

const resolved = (): Promise<void> => Promise.resolve();

export function TextField(props: TextFieldProps): ReactElement {
  const { ref, ...rest } = props;
  useImperativeHandle(
    ref,
    () => ({ setText: resolved, focus: resolved, blur: resolved, setSelection: resolved }),
    [],
  );
  return renderHost('expo-ui-textfield', rest);
}

export type SecureFieldRef = {
  setText: (newText: string) => Promise<void>;
  focus: () => Promise<void>;
  blur: () => Promise<void>;
};

export type SecureFieldProps = {
  ref?: Ref<SecureFieldRef>;
  defaultValue?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onValueChange?: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
} & CommonViewModifierProps;

export function SecureField(props: SecureFieldProps): ReactElement {
  const { ref, ...rest } = props;
  useImperativeHandle(ref, () => ({ setText: resolved, focus: resolved, blur: resolved }), []);
  return renderHost('expo-ui-securefield', rest);
}

// --- Namespace ---

export type NamespaceProps = { id: string; children: ReactNode };
export const Namespace = host<NamespaceProps>('expo-ui-namespace');

// --- GlassEffectContainer ---

export type GlassEffectContainerProps = {
  children: ReactNode;
  spacing?: number;
} & CommonViewModifierProps;
export const GlassEffectContainer = host<GlassEffectContainerProps>('expo-ui-glasseffectcontainer');

// --- ScrollView ---

export type ScrollViewProps = {
  children: ReactNode;
  axes?: 'vertical' | 'horizontal' | 'both';
  showsIndicators?: boolean;
} & CommonViewModifierProps;
export const ScrollView = host<ScrollViewProps>('expo-ui-scrollview');

// --- Shapes ---

export type RectangleProps = CommonViewModifierProps;
export const Rectangle = host<RectangleProps>('expo-ui-rectangle');

export type RoundedRectangleProps = { cornerRadius?: number } & CommonViewModifierProps;
export const RoundedRectangle = host<RoundedRectangleProps>('expo-ui-roundedrectangle');

export type EllipseProps = CommonViewModifierProps;
export const Ellipse = host<EllipseProps>('expo-ui-ellipse');

export type UnevenRoundedRectangleProps = {
  topLeadingRadius?: number;
  topTrailingRadius?: number;
  bottomLeadingRadius?: number;
  bottomTrailingRadius?: number;
} & CommonViewModifierProps;
export const UnevenRoundedRectangle = host<UnevenRoundedRectangleProps>(
  'expo-ui-unevenroundedrectangle',
);

export type CapsuleProps = { cornerStyle?: 'continuous' | 'circular' } & CommonViewModifierProps;
export const Capsule = host<CapsuleProps>('expo-ui-capsule');

export type CircleProps = CommonViewModifierProps;
export const Circle = host<CircleProps>('expo-ui-circle');

export type CornerStyleConfig =
  | { type: 'concentric'; minimumRadius?: number }
  | { type: 'fixed'; radius: number };

export type ConcentricRectangleCornerParams = {
  topLeadingCorner?: CornerStyleConfig;
  topTrailingCorner?: CornerStyleConfig;
  bottomLeadingCorner?: CornerStyleConfig;
  bottomTrailingCorner?: CornerStyleConfig;
};

export type ConcentricRectangleProps = {
  corners?: ConcentricRectangleCornerParams;
} & CommonViewModifierProps;

export const EdgeCornerStyle = {
  concentric: (minimumRadius?: number): CornerStyleConfig => ({
    type: 'concentric',
    minimumRadius,
  }),
  fixed: (radius: number): CornerStyleConfig => ({ type: 'fixed', radius }),
};

export const ConcentricRectangle = host<ConcentricRectangleProps>('expo-ui-concentricrectangle');

// --- Overlay ---

export type OverlayProps = { children: ReactNode; alignment?: Alignment } & CommonViewModifierProps;

const OverlayContent = slotComponent('content');

function Overlay(props: OverlayProps): ReactElement {
  return renderHost('expo-ui-overlay', props);
}
Overlay.Content = OverlayContent;
export { Overlay };

// --- Popover ---

export type PopoverViewProps = {
  children: ReactNode;
  isPresented?: boolean;
  onIsPresentedChange?: (isPresented: boolean) => void;
  attachmentAnchor?: 'leading' | 'trailing' | 'center' | 'top' | 'bottom';
  arrowEdge?: 'leading' | 'trailing' | 'top' | 'bottom' | 'none';
} & CommonViewModifierProps;

const PopoverTrigger = slotComponent('trigger');
const PopoverContent = slotComponent('popover');

function Popover(props: PopoverViewProps): ReactElement {
  const { children, ...rest } = props;
  return renderHost('expo-ui-popover', {
    ...rest,
    children: visibleChildren(children, props.isPresented, [PopoverTrigger]),
  });
}
Popover.Trigger = PopoverTrigger;
Popover.Content = PopoverContent;
export { Popover };

// --- Grid ---

export type GridProps = {
  alignment?: Alignment;
  verticalSpacing?: number;
  horizontalSpacing?: number;
  children: ReactNode;
} & CommonViewModifierProps;

const GridRow = host<{ children: ReactNode }>('expo-ui-gridrow');

function Grid(props: GridProps): ReactElement {
  return renderHost('expo-ui-grid', props);
}
Grid.Row = GridRow;
export { Grid };

// --- RNHostView ---

export type RNHostViewProps = {
  matchContents?: boolean;
  children: ReactElement;
};

export const RNHostView = host<RNHostViewProps>('expo-ui-rnhostview');

// --- Link ---

export type LinkProps = {
  label?: string;
  destination: string;
  children?: ReactElement | ReactElement[];
} & CommonViewModifierProps;

export const Link = host<LinkProps>('expo-ui-link');
