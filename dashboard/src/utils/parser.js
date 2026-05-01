export const INITIAL_BALANCE = 370;

export function parseLog(logText) {
  // Strip ANSI escape codes
  const cleanText = logText.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = cleanText.split('\n');

  const history = [];
  let currentBlock = null;
  let settings = null;

  // Regexes
  const checkRegex = /\[(.*?)\]\s+.*?REBALANCER CHECK #(\d+)/;
  const portfolioRegex = /Portfolio Value:\s*\$([0-9.]+)/;
  const marginRegex = /Free Margin:\s*\$([0-9.]+).*?Margin Used:\s*([0-9.]+)%/;
  const statsRegex = /Rebalances:\s*(\d+).*?Fees Paid:\s*\$([0-9.]+)/;
  const assetRegex = /[├└]─\s+(\w+)\s+\$\s*([+-]?[0-9.]+)\s+([+-]?[0-9.]+)%\s+([+-]?[0-9.]+)%\s+([+-]?[0-9.]+)%\s+\$([0-9.]+)\s+\$([0-9.]+)\s+([+-]?\$[+-]?[0-9.]+)\s+([+-]?[0-9.]+)/;

  for (const line of lines) {
    if (!settings) {
      settings = {
        interval: '7d',
        drift: '5.0',
        assetHarvest: 'OFF',
        compound: 'OFF',
        autoScale: 'OFF'
      };
    }

    // Extract settings line by line
    const intervalMatch = line.match(/Interval:\s*(.*?)d\s*\|/);
    if (intervalMatch) settings.interval = intervalMatch[1] + 'd';
    
    const driftMatch = line.match(/Drift:\s*±([0-9.]+)%/);
    if (driftMatch) settings.drift = driftMatch[1];
    
    const assetHarvestMatch = line.match(/Asset-Harvest:\s*(.*?)(?:\s*\||$)/);
    if (assetHarvestMatch) settings.assetHarvest = assetHarvestMatch[1];
    
    const compoundMatch = line.match(/Compound:\s*(.*?)(?:\s*\||$)/);
    if (compoundMatch) settings.compound = compoundMatch[1];
    
    const autoScaleMatch = line.match(/Auto-Scale:\s*(ON|OFF)/);
    if (autoScaleMatch) settings.autoScale = autoScaleMatch[1];

    const checkMatch = line.match(checkRegex);
    if (checkMatch) {
      if (currentBlock && currentBlock.portfolioValue !== null) {
        history.push(currentBlock);
      }
      currentBlock = {
        timestamp: checkMatch[1],
        checkNum: parseInt(checkMatch[2]),
        portfolioValue: null,
        freeMargin: null,
        marginUsed: null,
        rebalances: 0,
        feesPaid: 0,
        assets: []
      };
      continue;
    }

    if (currentBlock) {
      if (currentBlock.portfolioValue === null) {
        const pMatch = line.match(portfolioRegex);
        if (pMatch) {
          currentBlock.portfolioValue = parseFloat(pMatch[1]);
        }
      }

      const mMatch = line.match(/Free Margin:\s*\$([0-9.]+)\s+\((\d+)×.*?Margin Used:\s*([0-9.]+)%/);
      if (mMatch) {
        currentBlock.freeMargin = parseFloat(mMatch[1]);
        currentBlock.leverage = parseInt(mMatch[2]);
        currentBlock.marginUsed = parseFloat(mMatch[3]);
      }

      const sMatch = line.match(statsRegex);
      if (sMatch) {
        currentBlock.rebalances = parseInt(sMatch[1]);
        currentBlock.feesPaid = parseFloat(sMatch[2]);
      }

      const aMatch = line.match(assetRegex);
      if (aMatch) {
        currentBlock.assets.push({
          symbol: aMatch[1],
          notional: parseFloat(aMatch[2]),
          weight: parseFloat(aMatch[3]),
          target: parseFloat(aMatch[4]),
          drift: parseFloat(aMatch[5]),
          entry: parseFloat(aMatch[6]),
          mark: parseFloat(aMatch[7]),
          pnlStr: aMatch[8],
          pnlValue: parseFloat(aMatch[8].replace('$', '').replace('+', '')),
          qty: parseFloat(aMatch[9])
        });
      }
    }
  }

  if (currentBlock && currentBlock.portfolioValue !== null) {
    history.push(currentBlock);
  }

  // Calculate ROI based on $370 and True Equity (Portfolio Value / Leverage)
  history.forEach(block => {
    // Default to 4x leverage if it couldn't be parsed for some reason
    const leverage = block.leverage || 4;
    const trueEquity = block.portfolioValue / leverage;
    const totalProfit = trueEquity - INITIAL_BALANCE;
    block.roi = (totalProfit / INITIAL_BALANCE) * 100;
    block.trueEquity = trueEquity;
  });

  return {
    history,
    latest: history.length > 0 ? history[history.length - 1] : null,
    settings
  };
}
