/**
 * ConfigLoader Unit Tests
 * Tests YAML configuration loading and validation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigLoader } from '../config.js';
import path from 'path';
import fs from 'fs';

// Use the actual config directory
const CONFIG_DIR = path.resolve(process.cwd(), 'config');

describe('ConfigLoader', () => {
    let config: ConfigLoader;

    beforeEach(() => {
        config = new ConfigLoader(CONFIG_DIR);
    });

    describe('loadBusiness()', () => {
        it('should load business.yml successfully', () => {
            const biz = config.loadBusiness();
            expect(biz).toBeDefined();
            expect(biz.company).toBeDefined();
            expect(biz.company.name).toBeDefined();
            expect(typeof biz.company.name).toBe('string');
        });

        it('should have required business fields', () => {
            const biz = config.loadBusiness();
            // Business config should at minimum have company info
            expect(biz).toHaveProperty('company');
            expect(biz).toHaveProperty('product');
            expect(biz).toHaveProperty('channels');
        });
    });

    describe('loadICP()', () => {
        it('should load icp.yml successfully', () => {
            const icp = config.loadICP();
            expect(icp).toBeDefined();
        });

        it('should have targeting configuration', () => {
            const icp = config.loadICP();
            expect(icp.targeting).toBeDefined();
            expect(icp.targeting.industries).toBeDefined();
            expect(icp.targeting.industries.include).toBeInstanceOf(Array);
            expect(icp.targeting.industries.exclude).toBeInstanceOf(Array);
        });

        it('should have signal patterns', () => {
            const icp = config.loadICP();
            expect(icp.signals).toBeDefined();
            expect(icp.signals.strongPositive).toBeInstanceOf(Array);
            expect(icp.signals.moderatePositive).toBeInstanceOf(Array);
            expect(icp.signals.negative).toBeInstanceOf(Array);
        });

        it('should have thresholds', () => {
            const icp = config.loadICP();
            expect(icp.thresholds).toBeDefined();
            expect(typeof icp.thresholds.qualified).toBe('number');
            expect(typeof icp.thresholds.hot).toBe('number');
            expect(icp.thresholds.hot).toBeGreaterThan(icp.thresholds.qualified);
        });
    });

    describe('loadSequences()', () => {
        it('should load sequences.yml successfully', () => {
            const seq = config.loadSequences();
            expect(seq).toBeDefined();
        });

        it('should have at least one sequence', () => {
            const seq = config.loadSequences();
            expect(seq.sequences).toBeDefined();
            // sequences is a keyed object, not an array
            const keys = Object.keys(seq.sequences);
            expect(keys.length).toBeGreaterThan(0);
        });

        it('should have sequence steps with required fields', () => {
            const seq = config.loadSequences();
            const keys = Object.keys(seq.sequences);
            const first = seq.sequences[keys[0]];
            expect(first).toBeDefined();
            expect(first.steps).toBeInstanceOf(Array);
            expect(first.steps.length).toBeGreaterThan(0);

            const step = first.steps[0];
            expect(step.id).toBeDefined();
            expect(step.channel).toBeDefined();
            expect(step.template).toBeDefined();
        });
    });

    describe('loadAll()', () => {
        it('should load all configs at once', () => {
            const all = config.loadAll();
            expect(all.business).toBeDefined();
            expect(all.icp).toBeDefined();
            expect(all.sequences).toBeDefined();
        });
    });

    describe('error handling', () => {
        it('should throw when config directory is invalid', () => {
            const badConfig = new ConfigLoader('/nonexistent/path');
            expect(() => badConfig.loadBusiness()).toThrow();
        });
    });
});
