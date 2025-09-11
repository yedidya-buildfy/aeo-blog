// Test setup file
import { config } from "dotenv";
import '@testing-library/jest-dom';

// Load environment variables for testing
config();

// Mock window.fetch for API tests
global.fetch = jest.fn();