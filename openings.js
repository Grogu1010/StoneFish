(function () {
  // Stonefish opening book.
  //
  // Every opening is stored as exact coordinate moves, including both sides.
  // Stonefish v4.5 only reads the first 15 White openings and first 15 Black
  // openings. Later engines can unlock more entries by increasing those limits
  // or reading more arrays.
  //
  // A line is usable only while the full game history is still an exact prefix
  // of that line. If either side deviates, that line instantly stops matching.

  const WHITE_OPENINGS = [
    {
      name: "Ruy Lopez",
      lines: [
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "e1g1"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5c6", "d7c6"]
      ]
    },
    {
      name: "Italian Game",
      lines: [
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "c2c3", "g8f6", "d2d4"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "f3g5", "d7d5", "e4d5"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "b2b4"]
      ]
    },
    {
      name: "Queen's Gambit",
      lines: [
        ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "c1g5"],
        ["d2d4", "d7d5", "c2c4", "d5c4", "e2e4"],
        ["d2d4", "d7d5", "c2c4", "c7c6", "g1f3"]
      ]
    },
    {
      name: "English Opening",
      lines: [
        ["c2c4", "e7e5", "b1c3", "g8f6", "g2g3"],
        ["c2c4", "c7c5", "b1c3", "b8c6", "g2g3"],
        ["c2c4", "e7e6", "g1f3", "d7d5", "d2d4"]
      ]
    },
    {
      name: "Catalan Opening",
      lines: [
        ["d2d4", "g8f6", "c2c4", "e7e6", "g2g3", "d7d5", "f1g2", "f8e7", "g1f3", "e8g8", "e1g1"],
        ["d2d4", "d7d5", "c2c4", "e7e6", "g1f3", "g8f6", "g2g3", "f8e7", "f1g2"],
        ["d2d4", "g8f6", "c2c4", "e7e6", "g2g3", "d7d5", "f1g2", "d5c4"]
      ]
    },
    {
      name: "Scotch Game",
      lines: [
        ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4", "f3d4", "g8f6", "b1c3"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4", "f3d4", "f8c5", "c1e3"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4", "f3d4", "d8h4"]
      ]
    },
    {
      name: "Vienna Game",
      lines: [
        ["e2e4", "e7e5", "b1c3", "g8f6", "f2f4"],
        ["e2e4", "e7e5", "b1c3", "g8f6", "f1c4"],
        ["e2e4", "e7e5", "b1c3", "b8c6", "g2g3"]
      ]
    },
    {
      name: "London System",
      lines: [
        ["d2d4", "d7d5", "c1f4", "g8f6", "e2e3", "e7e6", "g1f3"],
        ["d2d4", "g8f6", "c1f4", "g7g6", "e2e3", "f8g7", "g1f3"],
        ["d2d4", "d7d5", "g1f3", "g8f6", "c1f4"]
      ]
    },
    {
      name: "King's Indian Attack",
      lines: [
        ["g1f3", "d7d5", "g2g3", "g8f6", "f1g2", "e7e6", "e1g1", "f8e7", "d2d3", "e8g8"],
        ["g1f3", "d7d5", "g2g3", "c7c5", "f1g2", "b8c6", "e1g1"],
        ["e2e4", "c7c5", "g1f3", "e7e6", "d2d3", "d7d5", "b1d2"]
      ]
    },
    {
      name: "Réti Opening",
      lines: [
        ["g1f3", "d7d5", "c2c4", "e7e6", "g2g3", "g8f6", "f1g2"],
        ["g1f3", "d7d5", "c2c4", "d5d4", "b2b4"],
        ["g1f3", "g8f6", "c2c4", "g7g6", "g2g3"]
      ]
    },
    {
      name: "King's Gambit",
      lines: [
        ["e2e4", "e7e5", "f2f4", "e5f4", "g1f3", "g7g5", "f1c4"],
        ["e2e4", "e7e5", "f2f4", "f8c5", "g1f3"],
        ["e2e4", "e7e5", "f2f4", "d7d5", "e4d5"]
      ]
    },
    {
      name: "Halloween Gambit",
      lines: [
        ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "f3e5"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "f3e5", "c6e5", "d2d4"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "f3e5", "f6e4", "d1e2"]
      ]
    },
    {
      name: "Danish Gambit",
      lines: [
        ["e2e4", "e7e5", "d2d4", "e5d4", "c2c3"],
        ["e2e4", "e7e5", "d2d4", "e5d4", "c2c3", "d4c3", "f1c4"],
        ["e2e4", "e7e5", "d2d4", "e5d4", "c2c3", "d4c3", "b1c3"]
      ]
    },
    {
      name: "Blackmar-Diemer Gambit",
      lines: [
        ["d2d4", "d7d5", "e2e4", "d5e4", "b1c3", "g8f6", "f2f3"],
        ["d2d4", "d7d5", "e2e4", "d5e4", "b1c3", "g8f6", "f2f3", "e4f3", "d1f3"],
        ["d2d4", "d7d5", "e2e4", "d5e4", "f2f3", "e4f3", "g1f3"]
      ]
    },
    {
      name: "Scholar's Mate",
      lines: [
        ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
        ["e2e4", "e7e5", "d1h5", "g7g6", "h5e5"],
        ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]
      ]
    }
    ,{
      name: "Giuoco Pianissimo",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "d2d3", "g8f6", "c2c3", "d7d6", "e1g1"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5", "e1g1", "d7d6", "c2c3"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "c2c3", "g8f6", "d2d3"]
      ]
    },
    {
      name: "Four Knights Game",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "f1b5", "f8b4", "e1g1"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "d2d4", "e5d4", "f3d4"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "f1c4", "f8c5", "e1g1"]
      ]
    },
    {
      name: "Colle System",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "d7d5", "g1f3", "g8f6", "e2e3", "e7e6", "f1d3", "c7c5", "c2c3", "b8c6"],
        ["d2d4", "g8f6", "g1f3", "e7e6", "e2e3", "d7d5", "f1d3", "c7c5", "c2c3"],
        ["d2d4", "d7d5", "g1f3", "g8f6", "e2e3", "e7e6", "b1d2"]
      ]
    },
    {
      name: "Torre Attack",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "g8f6", "g1f3", "e7e6", "c1g5", "f8e7", "e2e3", "e8g8", "f1d3"],
        ["d2d4", "g8f6", "g1f3", "g7g6", "c1g5", "f8g7", "b1d2", "e8g8"],
        ["d2d4", "g8f6", "g1f3", "d7d5", "c1g5", "e7e6", "e2e3"]
      ]
    },
    {
      name: "Trompowsky Attack",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "g8f6", "c1g5", "e7e6", "e2e4", "f8e7", "e4e5", "f6d5"],
        ["d2d4", "g8f6", "c1g5", "d7d5", "e2e3", "c7c5", "b1d2"],
        ["d2d4", "g8f6", "c1g5", "g7g6", "b1c3", "f8g7", "e2e4"]
      ]
    },
    {
      name: "Jobava London System",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "d7d5", "b1c3", "g8f6", "c1f4", "e7e6", "e2e3", "f8b4"],
        ["d2d4", "g8f6", "b1c3", "d7d5", "c1f4", "c7c5", "e2e3"],
        ["d2d4", "d7d5", "b1c3", "g8f6", "c1f4", "c8f5", "e2e3"]
      ]
    },
    {
      name: "English Botvinnik System",
      minStonefishVersion: 6,
      lines: [
        ["c2c4", "e7e5", "b1c3", "b8c6", "g2g3", "g7g6", "f1g2", "f8g7", "e2e4", "d7d6"],
        ["c2c4", "c7c5", "b1c3", "b8c6", "g2g3", "g7g6", "f1g2", "f8g7", "e2e4"],
        ["c2c4", "e7e5", "b1c3", "g8f6", "g2g3", "f8b4", "f1g2"]
      ]
    },
    {
      name: "Queen's Indian Attack",
      minStonefishVersion: 6,
      lines: [
        ["g1f3", "g8f6", "b2b3", "d7d5", "c1b2", "e7e6", "e2e3", "f8e7", "f1e2"],
        ["g1f3", "d7d5", "b2b3", "g8f6", "c1b2", "e7e6", "e2e3", "f8d6"],
        ["g1f3", "g8f6", "b2b3", "g7g6", "c1b2", "f8g7", "g2g3"]
      ]
    },
    {
      name: "Veresov Attack",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "d7d5", "b1c3", "g8f6", "c1g5", "e7e6", "e2e4"],
        ["d2d4", "g8f6", "b1c3", "d7d5", "c1g5", "b8d7", "e2e3"],
        ["d2d4", "d7d5", "b1c3", "g8f6", "c1g5", "c8f5", "f2f3"]
      ]
    },
    {
      name: "Panov Attack",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "c7c6", "d2d4", "d7d5", "e4d5", "c6d5", "c2c4", "g8f6", "b1c3"],
        ["e2e4", "c7c6", "d2d4", "d7d5", "e4d5", "c6d5", "c2c4", "g8f6", "g1f3"],
        ["e2e4", "c7c6", "d2d4", "d7d5", "e4d5", "c6d5", "f1d3", "b8c6"]
      ]
    }

  ];

  const BLACK_OPENINGS = [
    {
      name: "Sicilian Defense",
      lines: [
        ["e2e4", "c7c5"],
        ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"],
        ["e2e4", "c7c5", "g1f3", "b8c6", "d2d4", "c5d4", "f3d4"]
      ]
    },
    {
      name: "Caro-Kann Defense",
      lines: [
        ["e2e4", "c7c6"],
        ["e2e4", "c7c6", "d2d4", "d7d5", "e4e5", "c8f5"],
        ["e2e4", "c7c6", "d2d4", "d7d5", "b1c3", "d5e4", "c3e4", "c8f5"]
      ]
    },
    {
      name: "French Defense",
      lines: [
        ["e2e4", "e7e6"],
        ["e2e4", "e7e6", "d2d4", "d7d5", "e4e5", "c7c5", "c2c3", "b8c6"],
        ["e2e4", "e7e6", "d2d4", "d7d5", "b1c3", "g8f6"]
      ]
    },
    {
      name: "Nimzo-Indian Defense",
      lines: [
        ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"],
        ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4", "e2e3", "e8g8"],
        ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4", "d1c2", "e8g8"]
      ]
    },
    {
      name: "King's Indian Defense",
      lines: [
        ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7"],
        ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7", "e2e4", "d7d6"],
        ["d2d4", "g8f6", "c2c4", "g7g6", "g1f3", "f8g7", "g2g3", "e8g8"]
      ]
    },
    {
      name: "Slav Defense",
      lines: [
        ["d2d4", "d7d5", "c2c4", "c7c6"],
        ["d2d4", "d7d5", "c2c4", "c7c6", "g1f3", "g8f6", "b1c3", "d5c4"],
        ["d2d4", "d7d5", "c2c4", "c7c6", "c4d5", "c6d5"]
      ]
    },
    {
      name: "Queen's Gambit Declined",
      lines: [
        ["d2d4", "d7d5", "c2c4", "e7e6"],
        ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "c1g5", "f8e7"],
        ["d2d4", "d7d5", "c2c4", "e7e6", "g1f3", "g8f6", "g2g3", "f8e7"]
      ]
    },
    {
      name: "Grünfeld Defense",
      lines: [
        ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "d7d5"],
        ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "d7d5", "c4d5", "f6d5", "e2e4", "d5c3"],
        ["d2d4", "g8f6", "c2c4", "g7g6", "g2g3", "f8g7"]
      ]
    },
    {
      name: "Petrov Defense",
      lines: [
        ["e2e4", "e7e5", "g1f3", "g8f6"],
        ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "d7d6", "e5f3", "f6e4"],
        ["e2e4", "e7e5", "g1f3", "g8f6", "d2d4", "e5d4"]
      ]
    },
    {
      name: "Berlin Defense",
      lines: [
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "e1g1", "f6e4", "d2d4", "e4d6"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "d2d3", "d7d6"]
      ]
    },
    {
      name: "Stafford Gambit",
      lines: [
        ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "b8c6"],
        ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "b8c6", "e5c6", "d7c6"],
        ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "b8c6", "e5f7", "e8f7"]
      ]
    },
    {
      name: "Latvian Gambit",
      lines: [
        ["e2e4", "e7e5", "g1f3", "f7f5"],
        ["e2e4", "e7e5", "g1f3", "f7f5", "f3e5", "d8f6"],
        ["e2e4", "e7e5", "g1f3", "f7f5", "f1c4", "g8f6"]
      ]
    },
    {
      name: "Elephant Gambit",
      lines: [
        ["e2e4", "e7e5", "g1f3", "d7d5"],
        ["e2e4", "e7e5", "g1f3", "d7d5", "e4d5", "e5e4"],
        ["e2e4", "e7e5", "g1f3", "d7d5", "f3e5", "f8d6"]
      ]
    },
    {
      name: "Modern Defense",
      lines: [
        ["e2e4", "g7g6"],
        ["e2e4", "g7g6", "d2d4", "f8g7", "b1c3", "d7d6"],
        ["d2d4", "g7g6", "c2c4", "f8g7", "b1c3", "d7d6"]
      ]
    },
    {
      name: "Benko Gambit",
      lines: [
        ["d2d4", "g8f6", "c2c4", "c7c5", "d4d5", "b7b5"],
        ["d2d4", "g8f6", "c2c4", "c7c5", "d4d5", "b7b5", "c4b5", "a7a6"],
        ["d2d4", "g8f6", "c2c4", "c7c5", "d4d5", "b7b5", "g1f3", "b5b4", "g2g3", "g7g6"]
      ]
    }
    ,{
      name: "Semi-Slav Defense",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "d7d5", "c2c4", "c7c6", "g1f3", "g8f6", "b1c3", "e7e6"],
        ["d2d4", "d7d5", "c2c4", "c7c6", "b1c3", "g8f6", "g1f3", "e7e6"],
        ["d2d4", "d7d5", "c2c4", "c7c6", "g1f3", "g8f6", "e2e3", "e7e6"]
      ]
    },
    {
      name: "Queen's Indian Defense",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "b7b6"],
        ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "b7b6", "g2g3", "c8a6"],
        ["d2d4", "g8f6", "g1f3", "b7b6", "c2c4", "e7e6"]
      ]
    },
    {
      name: "Bogo-Indian Defense",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "f8b4"],
        ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "f8b4", "c1d2", "d8e7"],
        ["d2d4", "g8f6", "g1f3", "e7e6", "c2c4", "f8b4"]
      ]
    },
    {
      name: "Accelerated Dragon",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "c7c5", "g1f3", "b8c6", "d2d4", "c5d4", "f3d4", "g7g6"],
        ["e2e4", "c7c5", "g1f3", "b8c6", "d2d4", "c5d4", "f3d4", "g7g6", "c2c4", "g8f6"],
        ["e2e4", "c7c5", "b1c3", "b8c6", "g1f3", "g7g6"]
      ]
    },
    {
      name: "Kan Sicilian",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "c7c5", "g1f3", "e7e6", "d2d4", "c5d4", "f3d4", "a7a6"],
        ["e2e4", "c7c5", "g1f3", "e7e6", "d2d4", "c5d4", "f3d4", "a7a6", "f1d3"],
        ["e2e4", "c7c5", "b1c3", "e7e6", "g1f3", "a7a6"]
      ]
    },
    {
      name: "Classical Sicilian",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "b8c6"],
        ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"],
        ["e2e4", "c7c5", "b1c3", "d7d6", "g1f3", "g8f6"]
      ]
    },
    {
      name: "Scandinavian Defense",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5a5"],
        ["e2e4", "d7d5", "e4d5", "g8f6", "d2d4", "f6d5"],
        ["e2e4", "d7d5", "e4d5", "d8d5", "g1f3", "c8g4"]
      ]
    },
    {
      name: "Anti-Scholar Defense",
      minStonefishVersion: 6,
      lines: [
        ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g7g6"],
        ["e2e4", "e7e5", "d1h5", "g7g6", "h5e5", "g8f6"],
        ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g7g6"]
      ]
    },
    {
      name: "Anti-King's Indian Attack",
      minStonefishVersion: 6,
      lines: [
        ["g1f3", "d7d5", "g2g3", "c7c5", "f1g2", "b8c6", "e1g1", "e7e5"],
        ["g1f3", "d7d5", "g2g3", "c7c5", "f1g2", "g8f6", "e1g1", "b8c6"],
        ["g1f3", "g8f6", "g2g3", "d7d5", "f1g2", "c7c5", "e1g1", "b8c6"]
      ]
    },
    {
      name: "Ragozin Defense",
      minStonefishVersion: 6,
      lines: [
        ["d2d4", "d7d5", "c2c4", "e7e6", "g1f3", "g8f6", "b1c3", "f8b4"],
        ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "g1f3", "f8b4"],
        ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "d7d5", "b1c3", "f8b4"]
      ]
    }

  ];



  BLACK_OPENINGS.unshift({
    name: "Stonefish v6.5 Counter-Pin Defense",
    minStonefishVersion: 6.5,
    lines: [[
      "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "d2d3", "f8b4",
      "e1e2", "e8g8", "c1e3", "c6d4", "e3d4", "e5d4", "f3d4", "c7c5",
      "d4f5", "d7d5", "f5e3", "d5d4", "e3c4", "c8g4", "f2f3", "g4e6",
      "c4e5", "g7g5", "g2g4", "a7a5", "a2a4", "h7h6", "b2b3", "b7b6",
      "h2h3", "a8a7", "d1c1", "g8g7", "b5c6", "g7h7", "c1b2", "h7g8",
      "b2a2", "a7e7", "c2c4", "d4c3", "e2f2", "d8d4", "f2g2", "d4e5",
      "g2g1", "e5g3", "g1f1", "e6d5", "c6b5", "f6h7", "f1e2", "g3g2",
      "e2e3", "g2h1", "e3f2", "c3c2", "a2c2", "f7f6", "f2g3", "h1g1",
      "c2g2", "b4e1"
    ]]
  });

  WHITE_OPENINGS.unshift({
    name: "Stonefish v6.5 KIA Spear",
    minStonefishVersion: 6.5,
    lines: [[
      "g1f3", "d7d5", "g2g3", "c7c5", "f1g2", "b8c6", "e1g1", "e7e5",
      "d2d3", "c8f5", "b1c3", "h7h5", "c1e3", "g8f6", "a2a4", "f8d6",
      "h2h4", "e8g8", "a4a5", "a7a6", "f3g5", "e5e4", "d3e4", "f5g4",
      "e4d5", "c6e5", "f2f4", "e5g6", "d1d3", "g6e7", "b2b4", "c5b4",
      "c3e4", "f8e8", "e4f6", "g7f6", "d3h7", "g8f8", "h7f7"
    ]]
  });


  WHITE_OPENINGS.unshift({
    name: "Stonefish v6.5 Anti-Berlin Clamp",
    minStonefishVersion: 6.5,
    lines: [[
      "g1f3", "g8f6", "g2g3", "g7g6", "f1g2", "f8g7", "e1g1", "e8g8",
      "d2d3", "d7d6", "e2e4", "e7e5", "b1c3", "b8c6", "c1e3", "c8e6",
      "h2h3", "h7h6", "d1d2", "d8d7"
    ]]
  });

  const V6_WHITE_DENYLIST = new Set([
    "Scholar's Mate",
    "Blackmar-Diemer Gambit",
    "Danish Gambit",
    "King's Gambit",
    "Vienna Game"
  ]);

  const V6_BLACK_DENYLIST = new Set([
    "Stafford Gambit",
    "Latvian Gambit",
    "Elephant Gambit",
    "Benko Gambit",
    "Modern Defense"
  ]);

  function openingMinVersion(opening) {
    return opening && opening.minStonefishVersion ? opening.minStonefishVersion : 1;
  }

  function isOpeningAllowed(opening, color, engineVersion = 5) {
    const version = Number(engineVersion) || 5;
    if (!opening || version < openingMinVersion(opening)) return false;
    if (version >= 6) {
      const deny = color === "w" ? V6_WHITE_DENYLIST : V6_BLACK_DENYLIST;
      if (deny.has(opening.name)) return false;
    }
    return true;
  }

  function moveKey(move) {
    return `${"abcdefgh"[move.from.c]}${8 - move.from.r}${"abcdefgh"[move.to.c]}${8 - move.to.r}`;
  }

  function historyKeys(game) {
    return (game.moveHistory || []).map(entry => `${entry.from}${entry.to}`);
  }

  function openingLines(opening) {
    if (Array.isArray(opening.lines)) return opening.lines;
    if (Array.isArray(opening.moves)) return [opening.moves];
    return [];
  }

  function matchesPrefix(lineMoves, playedMoves) {
    if (playedMoves.length >= lineMoves.length) return false;
    for (let i = 0; i < playedMoves.length; i++) {
      if (lineMoves[i] !== playedMoves[i]) return false;
    }
    return true;
  }

  function getBookMoves(game, color, legalMoves, limit = 15) {
    const book = color === "w" ? WHITE_OPENINGS : BLACK_OPENINGS;
    const activeOpenings = book.slice(0, limit).filter(opening => isOpeningAllowed(opening, color, 4.5));
    const played = historyKeys(game);
    const legalByKey = new Map();

    for (const move of legalMoves) {
      legalByKey.set(moveKey(move), move);
    }

    const chosen = new Map();
    for (const opening of activeOpenings) {
      for (const line of openingLines(opening)) {
        if (!matchesPrefix(line, played)) continue;
        const nextKey = line[played.length];
        const move = legalByKey.get(nextKey);
        if (!move) continue;

        if (!chosen.has(nextKey)) {
          chosen.set(nextKey, { move, openings: [opening.name], line });
        } else if (!chosen.get(nextKey).openings.includes(opening.name)) {
          chosen.get(nextKey).openings.push(opening.name);
        }
      }
    }

    return Array.from(chosen.values());
  }

  window.StonefishOpenings = {
    WHITE_OPENINGS,
    BLACK_OPENINGS,
    FIRST_WHITE_LIMIT: 15,
    FIRST_BLACK_LIMIT: 15,
    V6_WHITE_DENYLIST,
    V6_BLACK_DENYLIST,
    openingMinVersion,
    isOpeningAllowed,
    getBookMoves,
    moveKey,
    historyKeys
  };
})();
