/**
 * Profile-patch persistence for the chat-archive plugin.
 *
 * chat-archive is mounted as a `- insert:` bundle row, so it is NOT surfaced
 * by the built-in config editor (`configEditor.entries()` only returns rows
 * whose parent is the `include` entry). To keep the plugin configurable we
 * persist edits to the profile's own `cordis.patch.yml` as a non-insert
 * override row:
 *
 *     - id: chat-archive
 *       name: '@ohmejj/dsh-chat-archive'
 *       config: { enabled: true, threshold: 48, ... }
 *
 * This mirrors the exact write path of the built-in `dsh-config-editor`
 * (`edit()`): write the full profile patch with a file lock + atomic write,
 * then `reconcileProfilePatches` on the root context so the loader re-reads
 * the patch and re-runs `apply(ctx, config)` with the merged config. All the
 * machinery below is reused verbatim from the verified dsh-config-editor
 * source to guarantee the same guarantees (no partial writes, rollback on
 * reconcile failure, home-patch override detection).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import yaml from 'js-yaml'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  composeEntries,
  loadProfileDirectory,
  readProfilePatches,
  reconcileProfilePatches,
} from '@deepseek-ai/dsh-app-boot'
import { Scalar, isMap, isSeq, parseDocument } from 'yaml'
import type { ChatArchiveConfig } from './config.js'

/** The profile entry id this plugin is mounted as (see cordis.patch.yml). */
export const ENTRY_ID = 'chat-archive'
export const ENTRY_NAME = '@ohmejj/dsh-chat-archive'

/** Flatten a row + its nested group configs, like the config editor. */
type PatchRow = { id?: string; group?: boolean | null; config?: unknown }
function flatten(rows: PatchRow[]): PatchRow[] {
  return rows.flatMap((row) => [row, ...row.group && Array.isArray(row.config) ? flatten(row.config as PatchRow[]) : []])
}

/**
 * Persist a config override for this plugin into the profile patch and
 * reconcile the running profile so `apply(ctx, newConfig)` fires. Mirrors the
 * built-in dsh-config-editor `edit()` implementation.
 *
 * @param rootCtx - the profile's root context (has loader & profileContext).
 * @param next - the full resolved config to persist.
 */
export async function writeConfigToProfile(rootCtx: any, next: Partial<ChatArchiveConfig>): Promise<void> {
  const profile = rootCtx.profileContext
  const path = profile.patchPath
  const run = async () => {
    await withFileLock(join(profile.dir, 'package.json'), async () => {
      const beforePatches = readProfilePatches('dsh', profile)
      await reconcileProfilePatches(rootCtx, beforePatches, 'dsh')

      const inherited = structuredClone(
        flatten(
          composeEntries([...loadProfileDirectory('dsh', profile.dir, profile.installAnchor).layers.map((l: any) => l.patches)]),
        ).find((row: any) => row.id === ENTRY_ID)?.config ?? {},
      )

      let before: string
      try {
        before = await readFile(path, 'utf8')
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error
        before = '[]\n'
      }
      const document = parseDocument(before, {
        customTags: [
          {
            tag: 'tag:yaml.org,2002:js',
            resolve: (value: string) => value,
          },
        ],
      })
      if (document.errors[0] !== undefined) throw document.errors[0]
      if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
      document.contents.flow = false
      const index = document.contents.items.findLastIndex(
        (item: any, i: number) =>
          isMap(item) &&
          document.getIn([i, 'id']) === ENTRY_ID &&
          !item.has('insert') &&
          (!item.has('name') || document.getIn([i, 'name']) === ENTRY_NAME),
      )
      if (isDeepStrictEqual(next, inherited)) {
        // Back to inherited: drop the override row.
        for (let i = document.contents.items.length - 1; i >= 0; i--) {
          const row: any = document.contents.items[i]
          if (!isMap(row) || document.getIn([i, 'id']) !== ENTRY_ID || row.has('insert')) continue
          row.delete('config')
          if (row.items.length === Number(row.has('id')) + Number(row.has('name'))) document.delete(i)
        }
      } else if (index < 0) {
        document.add(document.createNode({ id: ENTRY_ID, name: ENTRY_NAME, config: next }))
      } else {
        document.setIn([index, 'config'], document.createNode(next))
      }
      const patches: any[] = readProfilePatches('dsh', profile, {
        ...loadProfileDirectory('dsh', profile.dir, profile.installAnchor),
        patches: yaml.load(String(document)) as any,
      })
      if (
        !isDeepStrictEqual(
          flatten(composeEntries([patches])).find((row: any) => row.id === ENTRY_ID)?.config ?? {},
          next,
        )
      ) {
        throw new Error(`Configuration for "${ENTRY_ID}" is overridden by a home patch or command-line overlay`)
      }
      await writeFileAtomic(path, String(document), { mode: 384 })
      try {
        await reconcileProfilePatches(rootCtx, patches, 'dsh', [ENTRY_ID])
      } catch (error) {
        await writeFileAtomic(path, before, { mode: 384 })
        await reconcileProfilePatches(rootCtx, beforePatches, 'dsh')
        throw error
      }
    })
  }
  const hmr = rootCtx.get?.('hmr')
  await (hmr === undefined ? run() : hmr.runExclusive(run))
}