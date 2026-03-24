/**
 * Minimal stub for lightweight-charts used in test/offline environments.
 * Provides no-op implementations of all chart API calls the app makes.
 */
(function (global) {
  function noop() {}
  function returnSelf() { return this; }

  function makeSeries() {
    return {
      setData: noop,
      update: noop,
      applyOptions: noop,
      setMarkers: noop,
      priceToCoordinate: function() { return 0; },
    };
  }

  function makeTimeScale() {
    return {
      fitContent: noop,
      scrollToPosition: noop,
      setVisibleRange: noop,
      subscribeVisibleLogicalRangeChange: noop,
      unsubscribeVisibleLogicalRangeChange: noop,
    };
  }

  function makeChart() {
    var chart = {
      addAreaSeries: makeSeries,
      addLineSeries: makeSeries,
      addHistogramSeries: makeSeries,
      addBarSeries: makeSeries,
      addCandlestickSeries: makeSeries,
      timeScale: makeTimeScale,
      priceScale: function() { return { applyOptions: noop }; },
      applyOptions: noop,
      resize: noop,
      remove: noop,
      subscribeCrosshairMove: noop,
      unsubscribeCrosshairMove: noop,
    };
    return chart;
  }

  global.LightweightCharts = {
    createChart: function(container, options) {
      return makeChart();
    },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
  };
})(window);
