import { useRef, useState, useCallback, useEffect } from 'react'

interface VirtualListOptions {
  count: number
  itemHeight: number
  overscan?: number
}

interface VirtualItem {
  index: number
  start: number
  size: number
}

/**
 * Minimal virtual list hook — renders only visible rows + overscan.
 * No dependency on react-virtual for tighter control. Each row is a fixed height
 * (Superhuman's rows are uniform 56px), making this trivially fast.
 */
export function useVirtualList({ count, itemHeight, overscan = 5 }: VirtualListOptions) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)

  const onScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [onScroll])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const endIndex = Math.min(
    count - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  )

  const virtualItems: VirtualItem[] = []
  for (let i = startIndex; i <= endIndex; i++) {
    virtualItems.push({ index: i, start: i * itemHeight, size: itemHeight })
  }

  const totalSize = count * itemHeight

  /** Scroll the focused item into view */
  const scrollToIndex = useCallback((index: number) => {
    const el = scrollRef.current
    if (!el) return
    const itemTop = index * itemHeight
    const itemBottom = itemTop + itemHeight
    if (itemTop < el.scrollTop) {
      el.scrollTop = itemTop
    } else if (itemBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = itemBottom - el.clientHeight
    }
  }, [itemHeight])

  return { scrollRef, virtualItems, totalSize, scrollToIndex }
}
