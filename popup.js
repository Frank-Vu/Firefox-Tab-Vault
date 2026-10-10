'use strict';

const {
  VERSION,
  archiveToTxt,
  normalizeArchive,
  parseTxt
} = globalThis.TabVaultCore;

const {
  MIN_PASSWORD_LENGTH,
  decryptBackupContent,
  encryptBackupContent,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope
} = globalThis.TabVaultCrypto;

const elements = {
  contextBadge: document.getElementById('contextBadge'),
  exportScope: document.getElementById('exportScope'),
  encryptExport: document.getElementById('encryptExport'),
  exportJson: document.getElementById('exportJson'),
  exportTxt: document.getElementById('exportTxt'),
  importTarget: document.getElementById('importTarget'),
  chooseFile: document.getElementById('chooseFile'),
  fileInput: document.getElementById('fileInput'),
  status: document.getElementById('status'),
  passwordDialog: document.getElementById('passwordDialog'),
  passwordForm: document.getElementById('passwordForm'),
  passwordTitle: document.getElementById('passwordTitle'),
  passwordDescription: document.getElementById('passwordDescription'),
  passwordInput: document.getElementById('passwordInput'),
  passwordConfirmGroup: document.getElementById('passwordConfirmGroup'),
  passwordConfirm: document.getElementById('passwordConfirm'),
  passwordError: document.getElementById('passwordError'),
  passwordCancel: document.getElementById('passwordCancel'),
  passwordSubmit: document.getElementById('passwordSubmit'),
  reviewDialog: document.getElementById('reviewDialog'),
  reviewForm: document.getElementById('reviewForm'),
  reviewTitle: document.getElementById('reviewTitle'),
  reviewDescription: document.getElementById('reviewDescription'),
  reviewWarning: document.getElementById('reviewWarning'),
  reviewSelectAllOption: document.getElementById('reviewSelectAllOption'),
  reviewSelectAll: document.getElementById('reviewSelectAll'),
  reviewSelectionSummary: document.getElementById('reviewSelectionSummary'),
  reviewList: document.getElementById('reviewList'),
  reviewCancel: document.getElementById('reviewCancel'),
  reviewSubmit: document.getElementById('reviewSubmit')
};

let contextIsIncognito = false;
let sourceWindowId = null;
let passwordRequest = null;
let reviewRequest = null;
const pageOptions = new URLSearchParams(location.search);
const isImportPage = pageOptions.get('view') === 'import';

void initialize();

async function initialize() {
  setBusy(true);
  try {
    const currentWindow = await browser.windows.getCurrent();
    sourceWindowId = currentWindow.id;
    contextIsIncognito = Boolean(currentWindow.incognito);
    elements.encryptExport.checked = contextIsIncognito;
    elements.contextBadge.textContent = contextIsIncognito ? `Private · v${VERSION}` : `Normal · v${VERSION}`;
    elements.contextBadge.classList.toggle('incognito', contextIsIncognito);
    if (isImportPage) {
      document.body.classList.add('import-page');
      document.getElementById('exportSection').hidden = true;
      document.title = 'Import backup · Tab Vault';
      document.getElementById('importDestination').hidden = false;
      elements.chooseFile.textContent = 'Choose backup and restore';
      document.getElementById('importHint').textContent =
        'Choose a destination and backup, enter its password if encrypted, then review and confirm. Keep this tab open until you confirm.';
    }
    const previous = await callBackground({ type: 'result' });
    if (previous.pending) showStatus('A restore is still running in the background.');
    else if (previous.result) showRestoreResult(previous.result);
    setBusy(false);
  } catch (error) {
    showStatus(`Could not detect browser mode: ${error.message}`, 'error');
  }

  elements.exportJson.addEventListener('click', () => void exportBackup('json'));
  elements.exportTxt.addEventListener('click', () => void exportBackup('txt'));
  elements.chooseFile.addEventListener('click', () => {
    if (isImportPage) elements.fileInput.click();
    else void openImportPage();
  });
  elements.fileInput.addEventListener('change', () => void importSelectedFile());
  elements.passwordForm.addEventListener('submit', handlePasswordSubmit);
  elements.passwordCancel.addEventListener('click', () => finishPasswordRequest(null));
  elements.passwordDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishPasswordRequest(null);
  });
  elements.reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    finishArchiveReview(true);
  });
  elements.reviewSelectAll.addEventListener('change', toggleAllReviewTabs);
  elements.reviewList.addEventListener('change', (event) => {
    if (event.target.classList.contains('review-tab-checkbox')) {
      updateReviewSelection();
    }
  });
  elements.reviewCancel.addEventListener('click', () => finishArchiveReview(false));
  elements.reviewDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishArchiveReview(false);
  });
}

async function openImportPage() {
  clearStatus();
  setBusy(true);
  try {
    // The background owns the handoff so it can finish if Firefox dismisses the popup.
    await callBackground({ type: 'open-import' });
    window.close();
  } catch (error) {
    showStatus(`Could not open import: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function callBackground(message) {
  const response = await browser.runtime.sendMessage({
    ...message, channel: 'tab-vault', windowId: sourceWindowId
  });
  if (!response) throw new Error('Firefox did not respond. Reopen the extension.');
  if (response.error) throw new Error(response.error);
  return response.value;
}

function showRestoreResult(result) {
  const details = [`Restored ${countLabel(result.created, 'tab')}`, countLabel(result.groups, 'group')];
  if (result.failed) details.push(`${countLabel(result.failed, 'tab')} could not be opened`);
  if (result.warnings) details.push(`${countLabel(result.warnings, 'setting')} could not be restored`);
  showStatus(`${details.join(', ')}.`, result.created > 0 ? 'success' : 'error');
}

function setBusy(isBusy) {
  for (const control of [
    elements.exportScope,
    elements.encryptExport,
    elements.exportJson,
    elements.exportTxt,
    elements.importTarget,
    elements.chooseFile
  ]) {
    control.disabled = isBusy;
  }
}

function showStatus(message, kind = '') {
  elements.status.textContent = message;
  elements.status.className = `status visible ${kind}`.trim();
}

function clearStatus() {
  elements.status.textContent = '';
  elements.status.className = 'status';
}

function requestPassword(options) {
  elements.passwordTitle.textContent = options.title;
  elements.passwordDescription.textContent = options.description;
  elements.passwordSubmit.textContent = options.submitLabel;
  elements.passwordConfirmGroup.hidden = !options.confirmPassword;
  elements.passwordConfirm.required = options.confirmPassword;
  elements.passwordInput.autocomplete = options.confirmPassword ? 'new-password' : 'current-password';
  elements.passwordConfirm.autocomplete = 'new-password';
  elements.passwordInput.value = '';
  elements.passwordConfirm.value = '';
  elements.passwordError.textContent = '';

  return new Promise((resolve) => {
    passwordRequest = { resolve, options };
    elements.passwordDialog.showModal();
    window.setTimeout(() => elements.passwordInput.focus(), 0);
  });
}

function handlePasswordSubmit(event) {
  event.preventDefault();
  if (!passwordRequest) {
    return;
  }

  const password = elements.passwordInput.value;
  const minimumLength = passwordRequest.options.minimumLength || 1;
  if (Array.from(password).length < minimumLength) {
    elements.passwordError.textContent = minimumLength === 1
      ? 'Enter the backup password.'
      : `Use at least ${minimumLength} characters.`;
    elements.passwordInput.focus();
    return;
  }

  if (
    passwordRequest.options.confirmPassword &&
    password !== elements.passwordConfirm.value
  ) {
    elements.passwordError.textContent = 'The passwords do not match.';
    elements.passwordConfirm.focus();
    return;
  }

  finishPasswordRequest(password);
}

function finishPasswordRequest(result) {
  if (!passwordRequest) {
    return;
  }

  const { resolve } = passwordRequest;
  passwordRequest = null;
  elements.passwordInput.value = '';
  elements.passwordConfirm.value = '';
  elements.passwordError.textContent = '';
  if (elements.passwordDialog.open) {
    elements.passwordDialog.close();
  }
  resolve(result);
}

function archiveTabCount(archive) {
  return archive.windows.reduce((sum, windowData) => sum + windowData.tabs.length, 0);
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function createReviewTag(label) {
  const tag = document.createElement('span');
  tag.className = 'review-tab-tag';
  tag.textContent = label;
  return tag;
}

function renderArchiveReview(archive, selectable) {
  const windowSections = archive.windows.map((windowData, windowIndex) => {
    const section = document.createElement('section');
    section.className = 'review-window';

    const heading = document.createElement('h3');
    heading.className = 'review-window-title';
    const windowLabel = `Window ${windowIndex + 1} · ${countLabel(windowData.tabs.length, 'tab')}`;
    if (selectable && windowIndex === 0) {
      heading.classList.add('has-select-all');
      heading.appendChild(elements.reviewSelectAllOption);
    } else {
      heading.textContent = windowLabel;
    }
    section.appendChild(heading);

    const list = document.createElement('ol');
    list.className = 'review-tabs';

    for (const [tabIndex, tab] of windowData.tabs.entries()) {
      const item = document.createElement('li');
      item.className = 'review-tab';
      item.title = tab.url;

      const content = document.createElement(selectable ? 'label' : 'span');
      content.className = 'review-tab-content';

      if (selectable) {
        const checkbox = document.createElement('input');
        checkbox.id = `review-tab-${windowIndex}-${tabIndex}`;
        checkbox.className = 'review-tab-checkbox';
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.windowIndex = String(windowIndex);
        checkbox.dataset.tabIndex = String(tabIndex);
        checkbox.setAttribute('aria-label', `Include ${tab.title || tab.url}`);
        content.htmlFor = checkbox.id;
        item.classList.add('selectable');
        item.appendChild(checkbox);
      }

      const title = document.createElement('span');
      title.className = 'review-tab-title';
      title.textContent = tab.title || 'Untitled tab';
      content.appendChild(title);

      const url = document.createElement('span');
      url.className = 'review-tab-url';
      url.textContent = tab.url;
      content.appendChild(url);

      const group = tab.groupKey && windowData.groups[tab.groupKey];
      if (tab.pinned || group) {
        const metadata = document.createElement('span');
        metadata.className = 'review-tab-meta';
        if (tab.pinned) {
          metadata.appendChild(createReviewTag('Pinned'));
        }
        if (group) {
          metadata.appendChild(createReviewTag(group.title || 'Unnamed group'));
        }
        content.appendChild(metadata);
      }

      item.appendChild(content);
      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  });

  elements.reviewList.replaceChildren(...windowSections);
  elements.reviewList.scrollTop = 0;
}

function reviewTabCheckboxes() {
  return [...elements.reviewList.querySelectorAll('.review-tab-checkbox')];
}

function updateReviewSelection() {
  const checkboxes = reviewTabCheckboxes();
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  elements.reviewSelectAll.checked = selectedCount === checkboxes.length;
  elements.reviewSelectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  elements.reviewSelectionSummary.textContent = `${selectedCount} of ${checkboxes.length} selected`;
  elements.reviewSubmit.disabled = selectedCount === 0;
}

function toggleAllReviewTabs() {
  for (const checkbox of reviewTabCheckboxes()) {
    checkbox.checked = elements.reviewSelectAll.checked;
  }
  updateReviewSelection();
}

function selectedArchive(archive) {
  const selectedTabsByWindow = new Map();
  for (const checkbox of reviewTabCheckboxes()) {
    if (!checkbox.checked) {
      continue;
    }

    const windowIndex = Number(checkbox.dataset.windowIndex);
    if (!selectedTabsByWindow.has(windowIndex)) {
      selectedTabsByWindow.set(windowIndex, new Set());
    }
    selectedTabsByWindow.get(windowIndex).add(Number(checkbox.dataset.tabIndex));
  }

  const windows = archive.windows.flatMap((windowData, windowIndex) => {
    const selectedIndexes = selectedTabsByWindow.get(windowIndex);
    if (!selectedIndexes) {
      return [];
    }

    const tabs = windowData.tabs.filter((tab, tabIndex) => selectedIndexes.has(tabIndex));
    const usedGroupKeys = new Set(tabs.map((tab) => tab.groupKey).filter(Boolean));
    const groups = Object.fromEntries(
      Object.entries(windowData.groups).filter(([groupKey]) => usedGroupKeys.has(groupKey))
    );
    return [{ ...windowData, tabs, groups }];
  });

  return { ...archive, windows };
}

function requestArchiveReview(options) {
  elements.reviewTitle.textContent = options.title;
  elements.reviewDescription.textContent = options.description;
  elements.reviewSubmit.textContent = options.submitLabel;
  elements.reviewWarning.textContent = options.warning || '';
  elements.reviewWarning.hidden = !options.warning;
  elements.reviewSelectAllOption.hidden = !options.selectable;
  elements.reviewSelectAll.checked = true;
  elements.reviewSelectAll.indeterminate = false;
  elements.reviewSubmit.disabled = false;
  renderArchiveReview(options.archive, Boolean(options.selectable));
  if (options.selectable) {
    updateReviewSelection();
  }

  return new Promise((resolve) => {
    reviewRequest = {
      resolve,
      archive: options.archive,
      selectable: Boolean(options.selectable)
    };
    elements.reviewDialog.showModal();
    window.setTimeout(() => {
      const initialControl = options.selectable
        ? elements.reviewSelectAll
        : elements.reviewSubmit;
      initialControl.focus();
    }, 0);
  });
}

function finishArchiveReview(confirmed) {
  if (!reviewRequest) {
    return;
  }

  const { resolve, archive, selectable } = reviewRequest;
  const result = confirmed
    ? (selectable ? selectedArchive(archive) : archive)
    : null;
  if (confirmed && selectable && result.windows.length === 0) {
    updateReviewSelection();
    return;
  }

  reviewRequest = null;
  if (elements.reviewDialog.open) {
    elements.reviewDialog.close();
  }
  resolve(result);
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function triggerDownload(content, filename, mimeType) {
  return callBackground({ type: 'download', content, filename, mimeType });
}

async function exportBackup(format) {
  clearStatus();
  setBusy(true);

  try {
    const scope = elements.exportScope.value;
    showStatus('Collecting tabs for review…');
    const collectedArchive = await collectArchive(scope);
    const availableTabs = archiveTabCount(collectedArchive);
    clearStatus();

    const archive = await requestArchiveReview({
      archive: collectedArchive,
      title: `Review ${format.toUpperCase()} export`,
      description: `${countLabel(availableTabs, 'tab')} from ${countLabel(collectedArchive.windows.length, 'window')} are available.`,
      submitLabel: `Export ${format.toUpperCase()}`,
      selectable: true
    });
    if (!archive) {
      showStatus('Export cancelled.');
      return;
    }
    const totalTabs = archiveTabCount(archive);

    const shouldEncrypt = elements.encryptExport.checked;
    let password = null;
    if (shouldEncrypt) {
      password = await requestPassword({
        title: 'Encrypt backup',
        description: 'Create a password for this backup. You will need it whenever you restore the file.',
        submitLabel: 'Encrypt and export',
        confirmPassword: true,
        minimumLength: MIN_PASSWORD_LENGTH
      });
      if (password === null) {
        showStatus('Export cancelled.');
        return;
      }
    }

    const timestamp = safeFilePart(new Date().toISOString());
    const mode = contextIsIncognito ? 'private' : 'normal';
    const encryptedSuffix = shouldEncrypt ? '-encrypted' : '';
    const filename = `firefox-tabs-${mode}${encryptedSuffix}-${timestamp}.${format}`;
    const mimeType = format === 'json' ? 'application/json' : 'text/plain';
    const plaintext = format === 'json'
      ? `${JSON.stringify(archive, null, 2)}\n`
      : archiveToTxt(archive);
    let content = plaintext;

    if (shouldEncrypt) {
      showStatus('Encrypting backup locally…');
      const envelope = await encryptBackupContent(plaintext, password, format);
      content = serializeEncryptedEnvelope(envelope, format);
    }

    await triggerDownload(content, filename, mimeType);
    const action = shouldEncrypt ? 'Exported and encrypted' : 'Exported';
    showStatus(`${action} ${totalTabs} tab${totalTabs === 1 ? '' : 's'} from ${archive.windows.length} window${archive.windows.length === 1 ? '' : 's'}.`, 'success');
  } catch (error) {
    showStatus(`Export failed: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function collectArchive(scope) {
  return callBackground({ type: 'collect', scope });
}

async function importSelectedFile() {
  const file = elements.fileInput.files && elements.fileInput.files[0];
  if (!file) {
    return;
  }

  clearStatus();
  setBusy(true);

  try {
    const text = await file.text();
    const encryptedEnvelope = parseEncryptedEnvelope(text);
    let backupText = text;
    let formatHint = null;

    if (encryptedEnvelope) {
      const password = await requestPassword({
        title: 'Unlock encrypted backup',
        description: `Enter the password used to encrypt ${file.name}.`,
        submitLabel: 'Decrypt and review',
        confirmPassword: false,
        minimumLength: 1
      });
      if (password === null) {
        showStatus('Import cancelled.');
        return;
      }

      showStatus('Decrypting backup locally…');
      const decrypted = await decryptBackupContent(encryptedEnvelope, password);
      backupText = decrypted.plaintext;
      formatHint = decrypted.payloadFormat;
    }

    const archive = parseBackup(file.name, backupText, formatHint);
    const target = elements.importTarget.value;
    const totalTabs = archiveTabCount(archive);
    const targetIsCurrent = target === 'current';
    const shouldContinue = await requestArchiveReview({
      archive,
      title: 'Review tabs to import',
      description: `${file.name} contains ${countLabel(totalTabs, 'tab')} across ${countLabel(archive.windows.length, 'window')}.`,
      submitLabel: targetIsCurrent
        ? `Append ${countLabel(totalTabs, 'tab')}`
        : `Open ${countLabel(archive.windows.length, 'new window')}`,
      warning: archive.source.incognito === true && !contextIsIncognito
        ? 'This backup came from private browsing. Continuing here will open its URLs in normal windows and may add them to normal browser history.'
        : ''
    });
    if (!shouldContinue) {
      const privateSuggestion = archive.source.incognito === true && !contextIsIncognito
        ? ' Open a private window and run the extension there to restore privately.'
        : '';
      showStatus(`Import cancelled.${privateSuggestion}`);
      return;
    }

    const result = await callBackground({ type: 'restore', archive, target });

    showRestoreResult(result);
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, 'error');
  } finally {
    elements.fileInput.value = '';
    setBusy(false);
  }
}

function parseBackup(filename, text, formatHint = null) {
  const looksLikeJson = formatHint === 'json' || (
    formatHint === null &&
    (filename.toLowerCase().endsWith('.json') || /^[\s\r\n]*[\[{]/.test(text))
  );
  if (looksLikeJson) {
    try {
      return normalizeArchive(JSON.parse(text));
    } catch (error) {
      if (formatHint === 'json' || filename.toLowerCase().endsWith('.json')) {
        throw new Error(`Invalid JSON backup: ${error.message}`);
      }
    }
  }

  return parseTxt(text);
}
