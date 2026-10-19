---
id: ui
title: UI rules
paths: **/*.tsx, **/*.css
when: The change adds or edits user-facing components, styles, or layout.
---

## ui/theme-colors
Severity: error
Rule: Take every color from `theme.colors`.
Violated when: a style sets a color with a hex, rgb, or named literal.
Followed when: every color in the changed lines references a theme token.

Good:
```tsx
<Text style={{ color: theme.colors.foreground }}>Saved</Text>
```

Bad:
```tsx
<Text style={{ color: "#fff" }}>Saved</Text>
```

## ui/pressable-label
Severity: error
Rule: Give every `Pressable` an `accessibilityRole` and an `accessibilityLabel`.
Violated when: the change adds a `Pressable` without an `accessibilityLabel`.
Followed when: every `Pressable` in the changed lines has a role and a label.

Good:
```tsx
<Pressable accessibilityRole="button" accessibilityLabel="Save draft" onPress={save}>
  <Text style={styles.label}>Save</Text>
</Pressable>
```

Bad:
```tsx
<Pressable onPress={save}>
  <Text style={styles.label}>Save</Text>
</Pressable>
```

## ui/compact-layout
Severity: warning
Rule: Take screen padding and touch target sizes from `layout.compact`.
Violated when: a screen or row hard-codes one padding or height for every window size.
Followed when: padding and minimum heights switch on `layout.compact`.

Good:
```tsx
const styles = { screen: { padding: layout.compact ? 16 : 24 } };
```

Bad:
```tsx
const styles = { screen: { padding: 24 } };
```
