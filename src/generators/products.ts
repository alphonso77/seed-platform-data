import { faker } from '@faker-js/faker';
import { GeneratedProduct } from '@/types';

const PRODUCT_CATEGORIES = [
  'Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books',
  'Health & Beauty', 'Toys', 'Food & Drink', 'Office', 'Automotive',
];

export function generateProducts(count: number): GeneratedProduct[] {
  const products: GeneratedProduct[] = [];

  for (let i = 0; i < count; i++) {
    const category = faker.helpers.arrayElement(PRODUCT_CATEGORIES);
    products.push({
      name: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      price: parseFloat(faker.commerce.price({ min: 5, max: 500 })),
      currency: 'usd',
      sku: `SKU-${faker.string.alphanumeric(8).toUpperCase()}`,
      category,
      images: [`https://picsum.photos/seed/${faker.string.alphanumeric(8)}/400/400`],
    });
  }

  return products;
}
