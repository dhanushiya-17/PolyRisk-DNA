import { Module } from '@nitrostack/core';
import { CitationsService } from './citations.service.js';
import { CitationsTools } from './citations.tools.js';

@Module({
  name: 'citations',
  description: 'PubMed citation retrieval service for Polygenic Risk Score (PRS) evidence papers',
  providers: [CitationsService, CitationsTools],
  exports: [CitationsService],
})
export class CitationsModule {}
