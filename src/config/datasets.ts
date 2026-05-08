import { DatasetSize } from '@/types';

export const DATASET_SIZES: Record<DatasetSize, { contacts: number; products: number; orders: number }> = {
  small: { contacts: 25, products: 5, orders: 10 },
  medium: { contacts: 250, products: 25, orders: 100 },
  large: { contacts: 2500, products: 100, orders: 1000 },
};
