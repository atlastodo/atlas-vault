import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MAX_WIDTH, radius, space, usePalette } from "./theme";

/** A page: the background, safe areas and a centred column on wide screens. */
export function Screen({
  children,
  scroll = false,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Pinned below the content (a primary action). */
  footer?: ReactNode;
}) {
  const p = usePalette();
  const body = <View style={styles.column}>{children}</View>;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.background }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
      {footer ? <View style={styles.column}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/** The title row of a page, with actions on the right. */
export function Header({
  title,
  subtitle,
  left,
  right,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={styles.header}>
      {left}
      <View style={styles.fill}>
        <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.small, { color: p.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

type ButtonKind = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  kind = "secondary",
  disabled,
  busy,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const colors: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: p.accent, fg: p.onAccent, border: p.accent },
    secondary: { bg: p.surface, fg: p.text, border: p.border },
    danger: { bg: p.dangerSoft, fg: p.danger, border: p.dangerSoft },
    ghost: { bg: "transparent", fg: p.accent, border: "transparent" },
  };
  const c = colors[kind];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.bg, borderColor: c.border, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={c.fg} style={styles.spinner} /> : null}
      <Text style={[styles.buttonText, { color: c.fg }]}>{label}</Text>
    </Pressable>
  );
}

/** A labelled text input. */
export function Field({
  label,
  hint,
  error,
  multiline,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: p.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.muted}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: p.text,
            backgroundColor: p.surface,
            borderColor: error ? p.danger : focused ? p.accent : p.border,
          },
          style,
        ]}
        {...input}
      />
      {error ? (
        <Text style={[styles.small, { color: p.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.small, { color: p.muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const p = usePalette();
  const content = (
    <Text style={[styles.chipText, { color: selected ? p.onAccent : p.text }]}>{label}</Text>
  );
  const style = [
    styles.chip,
    {
      backgroundColor: selected ? p.accent : p.surfaceMuted,
      borderColor: selected ? p.accent : p.border,
    },
  ];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={style}
    >
      {content}
    </Pressable>
  );
}

/** A labelled on/off switch (RN's Switch, which react-native-web renders as a checkbox). */
export function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  const p = usePalette();
  return (
    <View style={styles.toggle}>
      <View style={styles.fill}>
        <Text style={[styles.body, { color: p.text }]}>{label}</Text>
        {hint ? <Text style={[styles.small, { color: p.muted }]}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: p.accent, false: p.border }}
      />
    </View>
  );
}

/** One choice of a few, as chips. */
export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const p = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: p.muted }]}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row}>
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            label={o.label}
            selected={o.value === value}
            onPress={() => onChange(o.value)}
            accessibilityLabel={`${label}: ${o.label}`}
          />
        ))}
      </View>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text accessibilityRole="header" style={[styles.sectionTitle, { color: p.muted }]}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }, style]}>
      {children}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.body, { color: p.muted }]}>{children}</Text>;
}

export function Body({ children, selectable }: { children: ReactNode; selectable?: boolean }) {
  const p = usePalette();
  return (
    <Text selectable={selectable} style={[styles.body, { color: p.text }]}>
      {children}
    </Text>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text accessibilityRole="alert" style={[styles.body, { color: p.danger }]}>
      {children}
    </Text>
  );
}

/** Ask before something destructive: `window.confirm` on the web (RN's Alert does nothing there). */
export function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === "web") {
    const ok =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(`${title}\n\n${message}`)
        : true;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: space.lg,
    flexShrink: 1,
  },
  scrollContent: { flexGrow: 1, paddingBottom: space.xxl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  title: { fontSize: 26, fontWeight: "700" },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: space.xs },
  field: { marginBottom: space.lg },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    fontSize: 16,
  },
  multiline: { minHeight: 120, lineHeight: 23 },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.lg },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    minHeight: 44,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  spinner: { marginRight: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 1,
  },
  chipText: { fontSize: 13, fontWeight: "500" },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.sm,
    gap: space.xs,
  },
});
