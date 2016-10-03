module.exports = {
  parserOptions: {
    ecmaVersion: 6,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },

  plugins: [
    'react',
    'import',
  ],

  extends: [
    'eslint:recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/react',
    'plugin:react/recommended',
    'airbnb',
  ],

  settings: {
    'import/resolver': {
      webpack: {
        config: './webpack/base.js',
        extensions: ['.js', '.jsx']
      }},
  },

  rules: {
    'import/extensions': [2, 'never']
  },

  globals: {
    describe: true,
    it: true,
    before: true,
    beforeEach: true,
    after: true,
    afterEach: true,
    chrome: true,
  },
};