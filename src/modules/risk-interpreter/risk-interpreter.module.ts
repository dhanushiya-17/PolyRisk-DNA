import { Module } from '@nitrostack/core';
import { RiskInterpreterService } from './risk-interpreter.service.js';
import { RiskInterpreterTools } from './risk-interpreter.tools.js';

@Module({
  name: 'risk-interpreter',
  description: 'Converts raw Polygenic Risk Scores (PRS) into population percentiles, risk tiers, and confidence ratings',
  providers: [RiskInterpreterService, RiskInterpreterTools],
  exports: [RiskInterpreterService],
})
export class RiskInterpreterModule {}
