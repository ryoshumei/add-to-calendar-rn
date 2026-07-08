// iOS system colors and spacing tokens. Switches automatically between light
// and dark mode based on system appearance.

import { useColorScheme } from 'react-native';

const light = {
  systemBlue: '#007AFF',
  systemRed: '#FF3B30',
  systemGreen: '#34C759',
  systemGray: '#8E8E93',
  systemGray2: '#AEAEB2',
  systemGray3: '#C7C7CC',
  systemGray4: '#D1D1D6',
  systemGray5: '#E5E5EA',
  systemGray6: '#F2F2F7',
  label: '#000000',
  secondaryLabel: '#3C3C43',
  tertiaryLabel: '#3C3C4399',
  separator: '#3C3C4349',
  background: '#F2F2F7', // grouped table bg
  groupedBackground: '#F2F2F7',
  // Backgrounds for modal sheets. iOS keeps these identical in light mode but
  // lightens them one step in dark mode so a sheet stands out from the black
  // screen it slides over.
  elevatedGroupedBackground: '#F2F2F7',
  elevatedCard: '#FFFFFF',
  card: '#FFFFFF',
  fill: '#78788033',
};

const dark = {
  systemBlue: '#0A84FF',
  systemRed: '#FF453A',
  systemGreen: '#30D158',
  systemGray: '#8E8E93',
  systemGray2: '#636366',
  systemGray3: '#48484A',
  systemGray4: '#3A3A3C',
  systemGray5: '#2C2C2E',
  systemGray6: '#1C1C1E',
  label: '#FFFFFF',
  secondaryLabel: '#EBEBF599',
  tertiaryLabel: '#EBEBF54D',
  separator: '#54545899',
  background: '#000000',
  groupedBackground: '#000000',
  elevatedGroupedBackground: '#1C1C1E',
  elevatedCard: '#2C2C2E',
  card: '#1C1C1E',
  fill: '#7878805C',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
};
