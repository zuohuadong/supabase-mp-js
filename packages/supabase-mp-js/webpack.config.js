const path = require('path')

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
]
