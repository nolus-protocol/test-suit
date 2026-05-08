module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        // Tests run in Node; avoid downleveling BigInt operations used by noble/*.
        targets: { node: 'current' },
      },
    ],
    '@babel/preset-typescript',
  ],
};
