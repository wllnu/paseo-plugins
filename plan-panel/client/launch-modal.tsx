import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

export interface LaunchFact {
  label: string;
  value: string;
}

export interface LaunchNote {
  tone: "warn" | "note";
  text: string;
}

export interface LaunchChoice {
  id: string;
  label: string;
  /** Provider and model, shown under the label. */
  detail: string;
}

export interface LaunchModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  title: string;
  icon: string;
  /** One or two sentences on what happens when confirmed. */
  intro: string;
  facts: readonly LaunchFact[];
  notes: readonly LaunchNote[];
  /** Agent configurations to pick from, e.g. profiles for the orchestrator. Omit to hide the picker. */
  choices?: readonly LaunchChoice[];
  choicesLabel?: string;
  choiceId?: string | null;
  onChoiceChange?(id: string): void;
  confirmLabel: string;
  busy: boolean;
  disabled?: boolean;
  onConfirm(): void;
}

/** Confirmation before the panel hands work to an agent: what happens, where it lands, and with which agent. */
export function LaunchModal({
  open,
  onOpenChange,
  theme,
  title,
  icon,
  intro,
  facts,
  notes,
  choices,
  choicesLabel,
  choiceId,
  onChoiceChange,
  confirmLabel,
  busy,
  disabled,
  onConfirm,
}: LaunchModalProps) {
  const styles = useMemo(
    () => ({
      intro: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      facts: { gap: 6 },
      factRow: { flexDirection: "row" as const, gap: 10 },
      factLabel: { width: 84, color: theme.colors.foregroundMuted, fontSize: 13 },
      factValue: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      label: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const },
      choices: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      choice: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 2,
      },
      choiceActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
      choiceLabel: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      choiceDetail: { color: theme.colors.foregroundMuted, fontSize: 11 },
      note: { flexDirection: "row" as const, gap: 8, alignItems: "flex-start" as const },
      noteText: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      actions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 8 },
      secondary: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      secondaryText: { color: theme.colors.foreground, fontWeight: "600" as const },
      primary: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      primaryDisabled: { opacity: 0.5 },
      primaryText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme],
  );

  const canConfirm = !busy && !disabled;

  return (
    <Modal
      title={title}
      icon={<Icon name={icon} size={18} color={theme.colors.foreground} />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Modal.Content>
        <Text style={styles.intro}>{intro}</Text>
        {facts.length > 0 ? (
          <View style={styles.facts}>
            {facts.map((fact) => (
              <View key={fact.label} style={styles.factRow}>
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {choices ? (
          <View style={{ gap: 8 }}>
            {choicesLabel ? <Text style={styles.label}>{choicesLabel}</Text> : null}
            <View style={styles.choices}>
              {choices.map((choice) => {
                const active = choice.id === choiceId;
                return (
                  <Pressable
                    key={choice.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.choice, active ? styles.choiceActive : null]}
                    onPress={() => onChoiceChange?.(choice.id)}
                  >
                    <Text style={styles.choiceLabel}>{choice.label}</Text>
                    <Text style={styles.choiceDetail}>{choice.detail}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        {notes.map((note) => (
          <View key={note.text} style={styles.note}>
            <Icon
              name={note.tone === "warn" ? "TriangleAlert" : "Info"}
              size={15}
              color={note.tone === "warn" ? theme.colors.statusWarning : theme.colors.foregroundMuted}
            />
            <Text style={styles.noteText}>{note.text}</Text>
          </View>
        ))}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => onOpenChange(false)}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm }}
            disabled={!canConfirm}
            style={[styles.primary, canConfirm ? null : styles.primaryDisabled]}
            onPress={onConfirm}
          >
            <Icon name={icon} size={16} color={theme.colors.accentForeground} />
            <Text style={styles.primaryText}>{busy ? "Starting…" : confirmLabel}</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
