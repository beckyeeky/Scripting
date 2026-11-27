import React from "react"
import type { OverlayAPI } from "../../overlay/types"
import { ReverseImageSearchSheet } from "./ReverseImageSearchSheet"

export const REVERSE_IMAGE_SEARCH_SHEET_ID = "reverse-image-search"

export interface ReverseImageSearchEntryOptions {
  /** Absolute path of an already-staged image (e.g. an ACTION_SEND attachment). */
  initialImagePath?: string | null
}

/**
 * Single entry point for the SauceNAO sheet. Used by the More tab and by the
 * Android share-intent handler so both routes share one sheet and its state.
 */
export function openReverseImageSearch(
  overlay: Pick<OverlayAPI, "presentSheet">,
  options?: ReverseImageSearchEntryOptions,
): void {
  const initialImagePath =
    typeof options?.initialImagePath === "string" && options.initialImagePath.trim()
      ? options.initialImagePath.trim()
      : null

  overlay.presentSheet({
    id: REVERSE_IMAGE_SEARCH_SHEET_ID,
    title: "以图搜图 (SauceNAO)",
    fullHeight: true,
    render: (close) => (
      <ReverseImageSearchSheet onClose={close} initialImagePath={initialImagePath} />
    ),
  })
}
