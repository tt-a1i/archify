# Matplotlib: a changed view is not changed data

Question: the same values A=80 and B=100 look much farther apart after the y-axis starts at70. What changed, and which ratio describes the values?

Runtime: Matplotlib3.11.2, Python3.12.13, Agg backend in isolated venv. Exact upstream tag v3.11.2: d3ca9172e392048ec242b90e8423e88d1a3000b2. Installed axes/_base.py and axes/_axes.py match the pinned source byte-for-byte. This only audits those Python modules, not every compiled wheel component.

Two supplied PNGs, images/zero.png and images/cropped.png, are actual outputs from the supplied probe, each768×576. The same two values, bar colors, figure dimensions and upper view limit110 are used; only set_ylim's lower argument changes0→70. Tick positions adapt automatically to that view. Both complete probe runs produce identical result JSON and PNG bytes. These are synthetic unitless example numbers, not measurements of people, businesses, performance or change over time.

Facts verified in probe-1.json:
- Both charts contain bar objects with bottom0 and heights80/100. Those properties remain unchanged after set_ylim. The method changes the axis view limits, not the data values or bar bottoms.
- With ylim(0,110), visible vertical segments represent80 and100 units; their geometric length ratio is1.25.
- With ylim(70,110), only10 and30 units of the bars remain visible. Measured clipped window heights are106.56 and319.68px, ratio3. The part from0 to70 is outside the view.
- The values still differ by20;100/80=1.25, and(100−80)/80=25%. The cropped visible-length ratio3 is not the data ratio.
- Geometry is measured from each bar's display bounding box intersected with the axes clipping window after canvas.draw; this is actual renderer geometry, not human perception measurement.

Primary sources:
- https://github.com/matplotlib/matplotlib/blob/d3ca9172e392048ec242b90e8423e88d1a3000b2/lib/matplotlib/axes/_base.py#L4165 (set_ylim changes view limits).
- https://github.com/matplotlib/matplotlib/blob/d3ca9172e392048ec242b90e8423e88d1a3000b2/lib/matplotlib/axes/_axes.py#L2307 (bar height and default bottom0).
- https://matplotlib.org/3.11.2/api/_as_gen/matplotlib.axes.Axes.bar.html
- Local probe contains actual values, geometry and PNG hashes.

Use both unchanged PNGs as visual evidence; choose the page layout and explanation independently. The figure labels A/B and Value need a plain Chinese explanation. The plotted numbers have no invented units. Do not claim that every plot type needs a zero axis or that axis zoom is always wrong. This case is a positive-value linear bar chart: comparing full bar lengths is easier to interpret when their zero reference is visible; viewing a restricted range can be useful, but its shown lengths are not the total values. If giving advice beyond the documented API, label the inference and tie it to this displayed example.

Scope excludes log axes, negative values, stacked bars and measured human understanding. Packaging caveats belong in the report, not the main reading flow. If showing a full runnable program, keep it complete and testable; an inline API call may be explicitly described as the changed line only. The complete rendering/probe script is available in source/probe.py, but does not have to be reproduced on the page. Raw upstream files and venv stay outside the repository.
