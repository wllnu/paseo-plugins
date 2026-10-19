import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import type { z } from "zod";
import { judgeSettings } from "../shared/contracts";

type Values = z.infer<typeof judgeSettings.schema>;

export function JudgeSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(judgeSettings);
  // A draft keeps the revision it started from, so a save cannot overwrite a newer document.
  const [draft, setDraft] = useState<{ values: Values; revision: string } | null>(null);

  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return (
      <Text style={{ color: theme.colors.statusDanger, fontSize: 14 }}>
        Could not load the settings. {settings.error}
      </Text>
    );
  }

  const { values: saved, revision } = settings;
  const current = draft?.values ?? saved;
  const edit = (patch: Partial<Values>) =>
    setDraft((previous) => ({
      values: { ...(previous?.values ?? saved), ...patch },
      revision: previous?.revision ?? revision,
    }));
  const save = async () => {
    if (draft && (await settings.save(draft.values, draft.revision))) setDraft(null);
  };

  return (
    <>
      <SettingsSection title="Judge">
        <SettingsCard>
          <SettingsInput
            label="Decisions URL"
            hint="The endpoint that answers typed questions about a diff. It must start with https."
            initialValue={saved.judgeUrl}
            onChangeText={(judgeUrl) => edit({ judgeUrl })}
          />
          <SettingsInput
            label="Model"
            initialValue={saved.model}
            onChangeText={(model) => edit({ model })}
          />
          <SettingsInput
            label="API key"
            hint="Stored as plain JSON on this host and readable by every client connected to it. To keep it out of settings, leave this empty and set PASEO_RULES_JUDGE_KEY in the daemon's environment."
            secureTextEntry
            initialValue={saved.apiKey}
            onChangeText={(apiKey) => edit({ apiKey })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Rules">
        <SettingsCard>
          <SettingsInput
            label="Global rules directory"
            hint="Rulesets here apply to every project. A ruleset in a project's .rules folder replaces a global one with the same id."
            initialValue={saved.globalRulesDir}
            onChangeText={(globalRulesDir) => edit({ globalRulesDir })}
          />
          <SettingsSwitch
            label="Check after every turn"
            hint="When off, checks run only from the Check now button."
            value={current.autoCheck}
            onValueChange={(autoCheck) => edit({ autoCheck })}
          />
        </SettingsCard>
        {draft ? (
          <SettingsCard>
            <SettingsAction
              label="Save changes"
              actionLabel="Save"
              error={settings.saveError}
              disabled={settings.saving}
              onPress={save}
            />
          </SettingsCard>
        ) : null}
      </SettingsSection>
    </>
  );
}
