// SAFE FILE REPLACEMENT (ALPHA-002 P1-5). A crash must never leave the user with
// NO valid copy of their file. Pure logic over an injected fs so the Node test
// harness exercises the SAME algorithm the Tauri host runs.
//
// Algorithm (backup-swap):
//   1. write the full new content to a temp sibling (.tmp);
//   2. if the destination exists, rename it aside to a backup sibling (.bak) —
//      this is still a complete, valid copy;
//   3. rename the temp into place;
//   4. on success, remove the backup (best-effort);
//   5. if step 3 fails, restore the backup so a valid copy always remains.
//
// We deliberately do NOT delete the destination before the replacement (the
// previous implementation did, opening a window where a crash left no file).

export interface AtomicFs {
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export async function atomicWrite(path: string, content: string, fs: AtomicFs): Promise<void> {
  const tmp = `${path}.tmp`;
  const bak = `${path}.bak`;

  // 1. Full write to temp. A failure here never touches the real file.
  await fs.writeText(tmp, content);

  if (!(await fs.exists(path))) {
    // No existing file — a single rename is already crash-safe.
    await fs.rename(tmp, path);
    return;
  }

  // 2. Move the current file aside (still valid) before touching the target.
  try { if (await fs.exists(bak)) await fs.remove(bak); } catch { /* stale bak */ }
  await fs.rename(path, bak);

  // 3. Put the new content in place.
  try {
    await fs.rename(tmp, path);
  } catch (e) {
    // 5. Restore — never leave the user with no file.
    try { await fs.rename(bak, path); } catch { /* both gone is impossible: bak still exists */ }
    // Clean up the temp we could not place.
    try { await fs.remove(tmp); } catch { /* best effort */ }
    throw e;
  }

  // 4. Success — drop the backup (best-effort; a leftover .bak is harmless).
  try { await fs.remove(bak); } catch { /* harmless */ }
}
