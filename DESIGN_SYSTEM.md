# GanSystems Design System

## Color Palette

### Semantic Colors
```css
--bg: #fafafa;                    /* Main background */
--bg-soft: #f5f5f5;               /* Soft background */
--surface: #ffffff;               /* Cards and surfaces */
--surface-strong: #f9f9f9;        /* Strong surface (hover) */
--surface-hover: #f0f0f0;         /* Hover state */

--text: #1a1a1a;                  /* Primary text */
--text-soft: #424242;             /* Secondary text */
--muted: #757575;                 /* Muted/disabled text */

--primary: #10b981;               /* Main action color (emerald) */
--primary-dim: rgba(16, 185, 129, 0.08);   /* Dim primary */
--primary-strong: #059669;        /* Strong primary (hover) */

--accent: #3b82f6;                /* Accent color (blue) */
--accent-dim: rgba(59, 130, 246, 0.08);    /* Dim accent */

--danger: #ef4444;                /* Error/danger (red) */
--danger-dim: rgba(239, 68, 68, 0.08);     /* Dim danger */

--warning: #f59e0b;               /* Warning (amber) */
--warning-dim: rgba(245, 158, 11, 0.08);   /* Dim warning */

--success: #10b981;               /* Success (emerald) */
```

### Borders
```css
--line: rgba(0, 0, 0, 0.06);           /* Subtle border */
--line-strong: rgba(0, 0, 0, 0.12);    /* Strong border */
```

### Shadows
```css
--shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
```

### Spacing
```css
--radius: 8px;                    /* Standard border radius */
--radius-lg: 12px;                /* Large border radius */
```

## Typography

### Font Stack
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", 
             "Ubuntu", "Cantarell", sans-serif;
```

### Font Sizes
| Use Case | Size | Weight | Line-height |
|----------|------|--------|-------------|
| Page Title | 1.8rem | 700 | 1.0 |
| Section Heading | 1.2rem | 600 | 1.2 |
| Body Text | 0.9rem | 400 | 1.5 |
| Label | 0.85rem | 500 | 1.2 |
| Caption | 0.8rem | 400 | 1.4 |
| Eyebrow | 0.65rem | 600 | 1.0 |

## Components

### Buttons

#### Primary Button
- Background: `var(--primary)`
- Color: white
- Padding: 0.6rem 1rem
- Font-weight: 600
- Hover: darker primary + shadow

#### Ghost Button
- Background: transparent
- Color: `var(--text-soft)`
- Border: 1px solid `var(--line-strong)`
- Hover: surface background

#### Danger Button
- Background: `var(--danger-dim)`
- Color: `var(--danger)`
- Border: 1px solid with danger color
- Hover: darker background

### Cards
- Background: `var(--surface)`
- Border: 1px solid `var(--line)`
- Border-radius: `var(--radius-lg)` (12px)
- Padding: 1.2rem
- Hover: subtle shadow

### Inputs
- Background: `var(--surface)`
- Border: 1px solid `var(--line-strong)`
- Border-radius: `var(--radius)` (8px)
- Padding: 0.65rem 0.85rem
- Focus: `var(--primary)` border + dim background

### Status Badges
- Online: Green (#10b981)
- Stale: Amber (#f59e0b)
- Offline: Red (#ef4444)
- Padding: 0.3rem 0.7rem
- Border-radius: 999px

## Responsive Breakpoints

| Breakpoint | Width | Changes |
|-----------|-------|---------|
| Desktop | 1100px+ | Full layout |
| Tablet | 760px - 1100px | Adjusted grid columns |
| Mobile | < 760px | Single column layout |

## Layout Grids

### Summary Grid
```css
grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
gap: 1rem;
```

### Controller Grid
```css
grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
gap: 1.2rem;
```

### Metric Grid
```css
grid-template-columns: 2fr 1fr;
gap: 1.5rem;
```

## Spacing Scale

| Token | Value |
|-------|-------|
| xs | 0.25rem |
| sm | 0.5rem |
| md | 1rem |
| lg | 1.5rem |
| xl | 2rem |
| 2xl | 3rem |

## Animation Timings

| Use Case | Duration |
|----------|----------|
| Hover states | 0.2s ease |
| Transitions | 0.15s ease |
| Subtle effects | 0.1s ease |

## Accessibility

- Minimum contrast ratio: 4.5:1 for text
- Focus states: Always visible (not removed)
- Touch targets: Minimum 44px
- Typography scale: Clear hierarchy for screen readers

## Dark Mode (Future)

Ready for dark mode implementation with CSS variables. Just update the `:root` variables in `globals.css`:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --surface: #1e293b;
    --text: #f1f5f9;
    /* ... etc */
  }
}
```
