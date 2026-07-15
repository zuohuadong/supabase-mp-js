const path = require('path')
const webpack = require('webpack')

const platformPath = path.resolve(__dirname, 'src/platform.ts')

function createMiniProgramCompatibilityPlugin() {
  return new webpack.ProvidePlugin({
    URL: [platformPath, 'SupabaseURL'],
    URLSearchParams: [platformPath, 'SupabaseURLSearchParams'],
  })
}

const base = {
  mode: 'production',
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true,
          compilerOptions: {
            module: 'ESNext',
          },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  performance: {
    hints: false,
  },
}

module.exports = [
  {
    ...base,
    name: 'umd',
    plugins: [createMiniProgramCompatibilityPlugin()],
    output: {
      path: path.resolve(__dirname, 'dist/umd'),
      filename: 'supabase.js',
      library: {
        type: 'umd',
        name: 'supabase',
      },
    },
  },
  {
    ...base,
    name: 'esm',
    plugins: [createMiniProgramCompatibilityPlugin()],
    experiments: {
      outputModule: true,
    },
    output: {
      path: path.resolve(__dirname, 'dist/module'),
      filename: 'index.mjs',
      library: {
        type: 'module',
      },
      module: true,
    },
  },
  {
    ...base,
    name: 'miniprogram',
    plugins: [createMiniProgramCompatibilityPlugin()],
    output: {
      path: path.resolve(__dirname, 'dist/miniprogram'),
      filename: 'index.js',
      library: {
        type: 'commonjs2',
      },
    },
  },
]
