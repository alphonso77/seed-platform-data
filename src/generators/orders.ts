import { faker } from '@faker-js/faker';
import { GeneratedOrder } from '@/types';

const ORDER_STATUSES = ['pending', 'processing', 'completed', 'cancelled'];

export function generateOrders(
  count: number,
  contactCount: number,
  productCount: number
): GeneratedOrder[] {
  const orders: GeneratedOrder[] = [];

  for (let i = 0; i < count; i++) {
    const itemCount = faker.number.int({ min: 1, max: Math.min(5, productCount) });
    const productIndices = faker.helpers.arrayElements(
      Array.from({ length: productCount }, (_, idx) => idx),
      itemCount
    );

    orders.push({
      contactIndex: faker.number.int({ min: 0, max: contactCount - 1 }),
      productIndices,
      quantities: productIndices.map(() => faker.number.int({ min: 1, max: 5 })),
      status: faker.helpers.arrayElement(ORDER_STATUSES),
      createdAt: faker.date.recent({ days: 90 }),
      notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }) ?? '',
    });
  }

  return orders;
}
