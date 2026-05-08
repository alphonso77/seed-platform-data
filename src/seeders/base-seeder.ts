import {
  PlatformConfig,
  SeedOptions,
  SeedResult,
  CleanOptions,
  CleanResult,
  EnvironmentCheck,
} from '@/types';

export abstract class BaseSeeder {
  constructor(protected config: PlatformConfig) {}

  abstract validateEnvironment(): Promise<EnvironmentCheck>;
  abstract seed(options: SeedOptions): Promise<SeedResult>;
  abstract clean(options: CleanOptions): Promise<CleanResult>;
  abstract getStatus(): Promise<{ connected: boolean; environment: string }>;
}
