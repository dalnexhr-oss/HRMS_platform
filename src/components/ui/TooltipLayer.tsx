'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

interface ActiveTooltip {
  element: Element;
  descriptionTarget: Element | null;
  text: string;
  rect: DOMRect;
}

interface TooltipPosition {
  active: ActiveTooltip;
  left: number;
  top: number;
  arrowLeft: number;
  side: 'top' | 'bottom';
}

function calculateTooltipPosition(rect: DOMRect, width: number, height: number) {
  const margin = 12;
  const gap = 8;
  const below = window.innerHeight - rect.bottom;
  const side = below < height + gap + margin && rect.top > below ? 'top' : 'bottom';
  const left = Math.max(
    margin,
    Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin),
  );
  const preferredTop = side === 'top' ? rect.top - height - gap : rect.bottom + gap;
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
  const arrowLeft = Math.max(12, Math.min(rect.left + rect.width / 2 - left, width - 12));
  return { left, top, arrowLeft, side } as const;
}

/** Displays a shared tooltip for annotated controls, including content rendered in portals. */
function TooltipLayer() {
  const id = useId();
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    let hovered: Element | null = null;
    let focused: Element | null = null;
    let dismissed: Element | null = null;

    function findTooltipTrigger(target: EventTarget | null): Element | null {
      return target instanceof Element ? target.closest('[data-tooltip-content]') : null;
    }

    function isInsideTooltip(target: EventTarget | null) {
      return target instanceof Node && !!tooltipRef.current?.contains(target);
    }

    function updateActiveTooltip() {
      if (!hovered?.isConnected) {
        hovered = null;
      }
      if (!focused?.isConnected) {
        focused = null;
      }
      const element = hovered ?? focused;
      const text = element?.getAttribute('data-tooltip-content')?.trim();
      if (!element || !text || element === dismissed || element.getAttribute('aria-expanded') === 'true') {
        setActive(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      if (
        !rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 ||
        rect.top >= window.innerHeight || rect.left >= window.innerWidth
      ) {
        setActive(null);
        return;
      }
      const control = focused === element && element.contains(document.activeElement)
        ? document.activeElement : element;
      const descriptionTarget = control?.getAttribute('aria-label') === text ? null : control;
      setActive((previous) =>
        previous?.element === element && previous.text === text &&
        previous.descriptionTarget === descriptionTarget &&
        previous.rect.left === rect.left && previous.rect.top === rect.top &&
        previous.rect.width === rect.width && previous.rect.height === rect.height
          ? previous
          : { element, descriptionTarget, text, rect },
      );
    }

    function onPointerOver(event: PointerEvent) {
      if (event.pointerType === 'touch' || isInsideTooltip(event.target)) {
        return;
      }
      hovered = findTooltipTrigger(event.target);
      if (dismissed !== hovered && dismissed !== focused) {
        dismissed = null;
      }
      updateActiveTooltip();
    }

    function onPointerOut(event: PointerEvent) {
      if (event.pointerType === 'touch' || isInsideTooltip(event.relatedTarget)) {
        return;
      }
      if (event.relatedTarget instanceof Node && hovered?.contains(event.relatedTarget)) {
        return;
      }
      hovered = findTooltipTrigger(event.relatedTarget);
      if (dismissed !== hovered && dismissed !== focused) {
        dismissed = null;
      }
      updateActiveTooltip();
    }

    function onFocusIn(event: FocusEvent) {
      focused = findTooltipTrigger(event.target);
      if (dismissed !== hovered && dismissed !== focused) {
        dismissed = null;
      }
      updateActiveTooltip();
    }

    function onFocusOut(event: FocusEvent) {
      focused = findTooltipTrigger(event.relatedTarget);
      if (dismissed !== hovered && dismissed !== focused) {
        dismissed = null;
      }
      updateActiveTooltip();
    }

    function dismissTooltip(event?: Event) {
      if (event && isInsideTooltip(event.target)) {
        return;
      }
      dismissed = findTooltipTrigger(event?.target ?? null) ?? hovered ?? focused;
      setActive(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        dismissTooltip();
      }
    }

    // Hint text and menu state can change while the pointer or keyboard focus stays put.
    const observer = new MutationObserver(() => {
      if (hovered || focused) {
        updateActiveTooltip();
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-tooltip-content', 'aria-expanded'],
    });
    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', dismissTooltip, true);
    document.addEventListener('click', dismissTooltip, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', dismissTooltip, true);
    window.addEventListener('resize', dismissTooltip);
    window.addEventListener('blur', dismissTooltip);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', dismissTooltip, true);
      document.removeEventListener('click', dismissTooltip, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', dismissTooltip, true);
      window.removeEventListener('resize', dismissTooltip);
      window.removeEventListener('blur', dismissTooltip);
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) {
      return;
    }
    const bounds = tooltipRef.current.getBoundingClientRect();
    setPosition({ active, ...calculateTooltipPosition(active.rect, bounds.width, bounds.height) });
    const target = active.descriptionTarget;
    if (!target) {
      return;
    }
    const descriptions = target.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
    if (!descriptions.includes(id)) {
      target.setAttribute('aria-describedby', [...descriptions, id].join(' '));
    }
    return () => {
      const remaining = target.getAttribute('aria-describedby')?.split(/\s+/)
        .filter((value) => value && value !== id) ?? [];
      if (remaining.length) {
        target.setAttribute('aria-describedby', remaining.join(' '));
      } else {
        target.removeAttribute('aria-describedby');
      }
    };
  }, [active, id]);

  if (!active) {
    return null;
  }
  const ready = position?.active === active;
  return createPortal(
    <span
      ref={tooltipRef}
      id={id}
      role="tooltip"
      className={styles.tooltip}
      data-side={ready ? position.side : 'bottom'}
      style={{
        left: ready ? position.left : 0,
        top: ready ? position.top : 0,
        visibility: ready ? 'visible' : 'hidden',
      }}
    >
      <span className={styles.content}>{active.text}</span>
      <span
        aria-hidden="true"
        className={styles.arrow}
        style={{ left: ready ? position.arrowLeft : 12 }}
      />
    </span>,
    document.body,
  );
}

export { TooltipLayer };
