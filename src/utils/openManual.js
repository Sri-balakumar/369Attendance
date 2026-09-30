// Ported from Showroom_check's src/utils/openManual.js.
//
// The SDK 54 File API's write() takes a string or a Uint8Array, so putting
// base64 through it means decoding by hand -- and getting that wrong writes a
// text file with a .pdf name. The legacy helper does exactly this one job.
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { fetchManual } from '../services/odoo';

/** Keep a filename usable as a filename, whatever was typed in the backend. */
const safeName = (name) => String(name || 'manual.pdf').replace(/[^\w.\- ]+/g, '_');

/** "%PDF-" at the head of the file, read straight from the base64. */
const looksLikePdf = (base64) => typeof base64 === 'string' && base64.startsWith('JVBERi');

/**
 * Fetch one manual and hand it to whatever opens PDFs on this device.
 *
 * Handing a browser the /web/content URL is not an option: it has no session
 * cookie, so the server would refuse. The bytes come over the same
 * authenticated RPC as everything else and are written to the cache first.
 */
export async function openManualPdf(manualId) {
  const doc = await fetchManual(manualId);
  if (!doc?.data) throw new Error('This manual is not available to you.');
  if (!looksLikePdf(doc.data)) throw new Error('This manual is not a readable PDF.');

  // Web build: no file system, so a blob URL in a new tab.
  if (Platform.OS === 'web') {
    const bytes = Uint8Array.from(atob(doc.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    window.open(url, '_blank');
    return;
  }

  const uri = `${FileSystem.cacheDirectory}${safeName(doc.filename)}`;
  await FileSystem.writeAsStringAsync(uri, doc.data, { encoding: 'base64' });

  // Android: hand the file to whatever reads PDFs. A content:// URI is
  // required because another app cannot read this one's cache, and flag 1
  // (FLAG_GRANT_READ_URI_PERMISSION) lends it read access for the intent.
  // A phone with no PDF reader throws here; the share sheet below is then
  // still a way to get the file somewhere it can be read.
  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: 'application/pdf',
      });
      return;
    } catch (e) {
      // fall through to the share sheet
    }
  }

  // iOS has no "open with" of its own; the share sheet lists the readers
  // under "Open in". Android lands here only when no reader took the intent.
  if (!(await Sharing.isAvailableAsync())) throw new Error('No app on this phone can open PDFs.');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: doc.name,
  });
}
