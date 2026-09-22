/**
 * MenuPicker — Android (SPEC "Shell chrome > Platform split").
 *
 * A `Row` — the label, the current value in accent ink, a disclosure chevron
 * (`chevronRight` rotated 90°, never a chevron.down) — that opens a
 * single-choice dialog: a transparent `Modal` with a scrim and a raised
 * `Surface` listing every option as a `Row` with a radio mark, plus Cancel.
 * That is Android's own shape for this (`AlertDialog.setSingleChoiceItems`).
 *
 * WHY NOT `Alert.alert`. RN's Android `Alert` holds at most THREE buttons
 * (`Alert.js`: `buttons.slice(0, 3)` — the rest are silently dropped), and the
 * control exists precisely for a choice longer than four. A drive-time picker
 * that showed three of six durations would be a lying control.
 *
 * Haptic: one `selectionAsync()` per tick, never for the selected index.
 */

import { selectionAsync } from 'expo-haptics';
import { useState } from 'react';
import { Modal, Pressable, View, type ViewStyle } from 'react-native';

import { spacing, useTheme } from '../../../theme';
import { Button } from '../Button';
import { Row } from '../Row';
import { Surface } from '../Surface';
import { Symbol } from '../Symbol';
import { Legend, Text } from '../Text';

import type { MenuPickerProps } from './index';

/** Disclosure is the forward chevron turned, never a name containing "down". */
const DISCLOSURE = { transform: [{ rotate: '90deg' }] } as const;

const ABSOLUTE_FILL: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

export function MenuPicker({
  options,
  selectedIndex,
  onChange,
  label,
  disabled = false,
  testID,
  style,
}: MenuPickerProps): React.JSX.Element {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options[selectedIndex] ?? '';

  const close = (): void => setOpen(false);
  const choose = (index: number): void => {
    setOpen(false);
    if (index === selectedIndex) return;
    void selectionAsync();
    onChange(index);
  };

  return (
    <>
      <Row
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityLabel={`${label}, ${current}`}
        accessibilityHint="Opens the choices"
        {...(testID !== undefined ? { testID } : {})}
        style={style}
        accessory={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text variant="body" tone="accent">
              {current}
            </Text>
            <Symbol name="chevronRight" size="sm" tone="muted" style={DISCLOSURE} />
          </View>
        }
      >
        <Text variant="body">{label}</Text>
      </Row>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.gutter }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={close}
            style={[ABSOLUTE_FILL, { backgroundColor: colors.scrim }]}
          />
          <Surface level="raised" padding="sm" corner="lg">
            <Legend style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
              {label}
            </Legend>
            {options.map((option, index) => {
              const selected = index === selectedIndex;
              return (
                <Row
                  key={option}
                  variant="inset"
                  onPress={() => choose(index)}
                  accessibilityLabel={selected ? `${option}, selected` : option}
                  leading={
                    <Symbol
                      name={selected ? 'checkmarkCircleFill' : 'circle'}
                      tone={selected ? 'accent' : 'muted'}
                    />
                  }
                >
                  <Text variant="body">{option}</Text>
                </Row>
              );
            })}
            <Button title="Cancel" variant="ghost" onPress={close} />
          </Surface>
        </View>
      </Modal>
    </>
  );
}
