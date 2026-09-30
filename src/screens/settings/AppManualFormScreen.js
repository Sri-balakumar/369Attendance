import React, { useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import {
  Card,
  AppTextInput,
  PrimaryButton,
  SelectSheet,
  ConfirmDialog,
  useToast,
} from '../../components';
import { saveManual, deleteManual } from '../../services/odoo';
import AdminScreen from '../config/AdminScreen';
import { AUDIENCES } from './AppManualScreen';

/** The picked file as bare base64, on a phone or in the web build. */
async function readBase64(asset) {
  if (Platform.OS !== 'web') {
    return FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
  }
  const blob = asset.file || (await (await fetch(asset.uri)).blob());
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return String(dataUrl).split(',')[1] || '';
}

/**
 * Admin: add an app manual, or change / replace / remove one.
 *
 * Only reached from App Manual when the server says can_edit, and the server
 * refuses the write for anyone else regardless. Uploads land on the Mobile app
 * shelf -- the module's own guides are never touched from here.
 */
export default function AppManualFormScreen({ navigation, route }) {
  const manual = route?.params?.manual || null;
  const id = manual?.id || null;
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();

  const [name, setName] = useState(manual?.name || '');
  const [description, setDescription] = useState(manual?.description || '');
  const [audience, setAudience] = useState(manual?.audience || 'all');
  const [file, setFile] = useState(null); // { name, base64 } once picked
  const [sheet, setSheet] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const base64 = await readBase64(asset);
      // Same "%PDF-" check the server makes, so the answer comes before the upload.
      if (!base64.startsWith('JVBERi')) {
        showToast('That file is not a PDF.', 'danger');
        return;
      }
      setFile({ name: asset.name || 'manual.pdf', base64 });
      if (!name.trim()) setName((asset.name || '').replace(/\.pdf$/i, ''));
      if (errors.file) setErrors((e) => ({ ...e, file: undefined }));
    } catch (e) {
      showToast(e?.message || 'Could not read that file.', 'danger');
    }
  };

  const submit = async () => {
    const next = {};
    if (!name.trim()) next.name = 'Give the manual a title.';
    if (!id && !file) next.file = 'Pick the PDF to upload.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await saveManual(id, {
        name: name.trim(),
        description: description.trim(),
        audience,
        filename: file?.name,
        base64: file?.base64,
      });
      showToast(id ? 'Manual updated.' : 'Manual added.', 'success');
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Could not save the manual.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await deleteManual(id);
      showToast('Manual removed.', 'success');
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Could not remove the manual.', 'danger');
    } finally {
      setDeleting(false);
    }
  };

  const fileLabel = file?.name || manual?.filename || 'No PDF chosen';

  return (
    <AdminScreen
      navigation={navigation}
      title={id ? 'Edit manual' : 'Add manual'}
      subtitle={id ? manual.name : 'Shown in App Manual'}
    >
      <Card>
        <AppTextInput
          label="Title"
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
          }}
          icon="book-outline"
          error={errors.name}
        />
        <AppTextInput
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          icon="reader-outline"
          style={{ marginTop: spacing.base }}
        />
        <AppTextInput
          label="Shown to"
          value={AUDIENCES.find((a) => a.value === audience)?.label || ''}
          icon="people-outline"
          editable={false}
          onPress={() => setSheet(true)}
          rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
          style={{ marginTop: spacing.base }}
        />

        <Pressable
          onPress={pick}
          accessibilityRole="button"
          accessibilityLabel={id ? 'Replace the PDF' : 'Choose a PDF'}
          style={({ pressed }) => [
            styles.file,
            {
              marginTop: spacing.base,
              borderColor: errors.file ? colors.danger : colors.border,
              backgroundColor: pressed ? withAlpha(colors.primary, 0.08) : 'transparent',
            },
          ]}
        >
          <Ionicons name="document-attach-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
              {fileLabel}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
              {file ? 'Will be uploaded on save' : id ? 'Tap to replace the PDF' : 'Tap to choose a PDF'}
            </Text>
          </View>
        </Pressable>
        {errors.file ? (
          <Text style={{ color: colors.danger, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 6 }}>
            {errors.file}
          </Text>
        ) : null}
      </Card>

      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.regular,
          fontSize: fontSize.xs,
          marginTop: spacing.md,
          lineHeight: 17,
        }}
      >
        Admins see every manual. HR and employees see the ones for their role
        plus the Everyone ones. Changes reach every phone straight away.
      </Text>

      <PrimaryButton
        label={id ? 'Save changes' : 'Add manual'}
        loading={saving}
        onPress={submit}
        style={{ marginTop: spacing.lg }}
      />

      {id ? (
        <PrimaryButton
          label="Remove manual"
          variant="ghost"
          tone="danger"
          loading={deleting}
          onPress={() => setConfirmDelete(true)}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      <SelectSheet
        visible={sheet}
        title="Shown to"
        icon="people-outline"
        options={AUDIENCES}
        value={audience}
        onSelect={setAudience}
        onClose={() => setSheet(false)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title="Remove this manual?"
        message="It disappears from App Manual on every phone. Upload it again to bring it back."
        confirmLabel="Remove"
        icon="trash-outline"
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
