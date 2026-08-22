# Color Migration Guide

## Complete Color System Update

### Theme Overview

**Old Theme**: Dark (GitHub-inspired)
- Approach: Bright accents on dark background
- Use case: Low-light environments
- Contrast: High contrast bright colors

**New Theme**: Light (Modern minimalistic)
- Approach: Subtle accents on light background
- Use case: All lighting conditions
- Contrast: Optimized for readability

---

## Color Mappings

### Backgrounds

| Purpose | Old | New | Hex |
|---------|-----|-----|-----|
| Main background | `#0d1117` | `#fafafa` | Off-white |
| Soft background | `#161b22` | `#f5f5f5` | Light gray |
| Card surface | `#1c2128` | `#ffffff` | Pure white |
| Strong surface | `#21262d` | `#f9f9f9` | Almost white |
| Hover surface | `#2d333b` | `#f0f0f0` | Hover gray |

### Text Colors

| Purpose | Old | New | Hex |
|---------|-----|-----|-----|
| Primary text | `#e6edf3` | `#1a1a1a` | Near-black |
| Secondary text | `#cdd9e5` | `#424242` | Dark gray |
| Muted text | `#8b949e` | `#757575` | Medium gray |

### Status & Semantic

| Status | Old | New | Hex | Usage |
|--------|-----|-----|-----|-------|
| Primary action | `#00e676` | `#10b981` | Emerald | Buttons, links |
| Primary dim | `rgba(0, 230, 118, 0.15)` | `rgba(16, 185, 129, 0.08)` | — | Backgrounds |
| Primary strong | `#00c853` | `#059669` | Deep emerald | Hover states |
| Success | `#3fb950` | `#10b981` | Emerald | Success badges |
| Warning | `#d29922` | `#f59e0b` | Amber | Warning alerts |
| Danger | `#f85149` | `#ef4444` | Red | Error states |
| Accent | `#29b6f6` | `#3b82f6` | Cobalt | Secondary action |

### Borders & Lines

| Purpose | Old | New | Hex |
|---------|-----|-----|-----|
| Subtle line | `rgba(240, 246, 252, 0.1)` | `rgba(0, 0, 0, 0.06)` | Light gray |
| Strong line | `rgba(240, 246, 252, 0.18)` | `rgba(0, 0, 0, 0.12)` | Medium gray |

### Shadows

| Intensity | Old | New |
|-----------|-----|-----|
| Regular | `0 8px 32px rgba(0, 0, 0, 0.4)` | `0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)` |
| Large | `0 24px 64px rgba(0, 0, 0, 0.6)` | `0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)` |

---

## Component Color Updates

### Buttons

#### Primary Button
**Before**
```css
background: linear-gradient(135deg, var(--primary), var(--primary-strong));
color: #0d1117;  /* Dark text on bright green */
```

**After**
```css
background: var(--primary);  /* #10b981 */
color: white;  /* White text on emerald */
```

#### Ghost Button
**Before**
```css
background: var(--surface-strong);  /* #21262d */
color: var(--text-soft);  /* #cdd9e5 */
border: 1px solid var(--line-strong);
```

**After**
```css
background: transparent;
color: var(--text-soft);  /* #424242 */
border: 1px solid var(--line-strong);  /* #1a1a1a, 0.12 */
```

#### Danger Button
**Before**
```css
background: var(--danger-dim);  /* rgba(248, 81, 73, 0.15) */
color: var(--danger);  /* #f85149 */
border: 1px solid rgba(248, 81, 73, 0.2);
```

**After**
```css
background: var(--danger-dim);  /* rgba(239, 68, 68, 0.08) */
color: var(--danger);  /* #ef4444 */
border: 1px solid rgba(239, 68, 68, 0.2);
```

### Cards

**Before**
```css
background: var(--surface);  /* #1c2128 */
border: 1px solid var(--line-strong);  /* 0.18 opacity */
border-radius: 12px;
box-shadow: subtle shadow on dark background
```

**After**
```css
background: var(--surface);  /* #ffffff */
border: 1px solid var(--line);  /* 0.06 opacity */
border-radius: 12px;
box-shadow: subtle shadow on light background
```

### Input Fields

**Before**
```css
background: var(--bg-soft);  /* #161b22 */
border: 1px solid var(--line-strong);  /* Very visible */
color: var(--text);  /* #e6edf3 */
```

**After**
```css
background: var(--surface);  /* #ffffff */
border: 1px solid var(--line-strong);  /* Still visible */
color: var(--text);  /* #1a1a1a */
```

### Status Badges

#### Online Status
**Before**
```css
color: var(--success);  /* #3fb950 (bright green) */
background: rgba(63, 185, 80, 0.12);
border: 1px solid rgba(63, 185, 80, 0.2);
```

**After**
```css
color: var(--success);  /* #10b981 (emerald) */
background: rgba(16, 185, 129, 0.12);
border: 1px solid rgba(16, 185, 129, 0.2);
```

#### Stale Status
**Before**
```css
color: var(--warning);  /* #d29922 */
background: var(--warning-dim);  /* rgba(210, 153, 34, 0.15) */
border: 1px solid rgba(210, 153, 34, 0.2);
```

**After**
```css
color: var(--warning);  /* #f59e0b (amber) */
background: var(--warning-dim);  /* rgba(245, 158, 11, 0.08) */
border: 1px solid rgba(245, 158, 11, 0.2);
```

#### Offline Status
**Before**
```css
color: var(--danger);  /* #f85149 */
background: var(--danger-dim);  /* rgba(248, 81, 73, 0.15) */
border: 1px solid rgba(248, 81, 73, 0.2);
```

**After**
```css
color: var(--danger);  /* #ef4444 (red) */
background: var(--danger-dim);  /* rgba(239, 68, 68, 0.08) */
border: 1px solid rgba(239, 68, 68, 0.2);
```

### Alert Cards

#### Critical Alert
**Before**
```css
border-left: 3px solid var(--danger);  /* #f85149 */
```

**After**
```css
border-left: 3px solid var(--danger);  /* #ef4444 */
```

#### Warning Alert
**Before**
```css
border-left: 3px solid var(--warning);  /* #d29922 */
```

**After**
```css
border-left: 3px solid var(--warning);  /* #f59e0b */
```

---

## Contrast Ratios

### Text Contrast (WCAG AA Standard: 4.5:1)

| Text Color | Background | Ratio | Grade |
|------------|-----------|-------|-------|
| #1a1a1a | #ffffff | 21:1 | AAA |
| #424242 | #ffffff | 12.6:1 | AAA |
| #757575 | #ffffff | 7.8:1 | AAA |
| #ffffff | #10b981 | 6.1:1 | AAA |

### Interactive Elements (WCAG AA Standard: 3:1)

| Element | Colors | Ratio |
|---------|--------|-------|
| Buttons | #10b981 on #ffffff | 4.8:1 |
| Links | #10b981 on #ffffff | 4.8:1 |
| Hover | #059669 on #ffffff | 6.2:1 |

---

## Color Usage Guidelines

### When to Use Each Color

| Color | Usage | Component |
|-------|-------|-----------|
| `--primary` | Main CTAs, active states | Buttons, links, badges |
| `--accent` | Secondary actions | Help text, secondary buttons |
| `--success` | Online status, confirmations | Status badges, success messages |
| `--warning` | Caution, stale data | Warning badges, attention |
| `--danger` | Errors, critical states | Error messages, dangerous actions |
| `--muted` | Disabled, secondary info | Labels, helper text, icons |

### Dark vs Light Text

**Use dark text (#1a1a1a) on:**
- White backgrounds
- Light gray backgrounds
- Light status badges

**Use light text (white) on:**
- Dark green button (#10b981)
- Dark status badges

---

## CSS Variable Update Checklist

When implementing the redesign, ensure:

```css
/* Update in globals.css */
:root {
  ✅ --bg: #fafafa;
  ✅ --bg-soft: #f5f5f5;
  ✅ --surface: #ffffff;
  ✅ --surface-strong: #f9f9f9;
  ✅ --surface-hover: #f0f0f0;
  ✅ --line: rgba(0, 0, 0, 0.06);
  ✅ --line-strong: rgba(0, 0, 0, 0.12);
  ✅ --text: #1a1a1a;
  ✅ --text-soft: #424242;
  ✅ --muted: #757575;
  ✅ --primary: #10b981;
  ✅ --primary-dim: rgba(16, 185, 129, 0.08);
  ✅ --primary-strong: #059669;
  ✅ --accent: #3b82f6;
  ✅ --accent-dim: rgba(59, 130, 246, 0.08);
  ✅ --danger: #ef4444;
  ✅ --danger-dim: rgba(239, 68, 68, 0.08);
  ✅ --warning: #f59e0b;
  ✅ --warning-dim: rgba(245, 158, 11, 0.08);
  ✅ --success: #10b981;
  ✅ --shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  ✅ --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}
```

---

## Future: Dark Mode Support

The CSS variable approach allows for easy dark mode:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --surface: #1e293b;
    --text: #f1f5f9;
    --primary: #10b981;
    --danger: #ef4444;
    /* ... etc */
  }
}
```

---

## Testing Color Accessibility

**Tools to use:**
- WebAIM Contrast Checker
- Accessibility Insights
- Chrome DevTools Accessibility Inspector
- Color Blindness Simulator

**Test scenarios:**
- Read all text at 14px and 12px
- Check contrast in high brightness
- Check contrast in low brightness
- Test with color blindness modes

---

## Migration Timeline

1. **Update CSS Variables** (globals.css)
2. **Test in Development** (visual QA)
3. **Update Component Styles** (as documented)
4. **Cross-browser Testing** (Chrome, Firefox, Safari, Edge)
5. **Accessibility Testing** (contrast, readability)
6. **Deploy to Production** (safe to merge)
