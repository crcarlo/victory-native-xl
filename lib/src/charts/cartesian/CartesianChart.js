import { Canvas, clamp } from "@shopify/react-native-skia";
import * as React from "react";
import {} from "react";
import {} from "react-native";
import { useDerivedValue, useSharedValue, withTiming, } from "react-native-reanimated";
import {} from "../../types";
import { CartesianContext, } from "./CartesianContext";
import { Gesture, GestureDetector, GestureHandlerRootView, } from "react-native-gesture-handler";
import { map } from "../interpolaters";
import { getMaxYFromMassagedData, getMinYFromMassagedData, massageInputData, } from "../../utils/massageInputData";
export function CartesianChart({ data, xKey = "x", padding = 20, children, }) {
    // Gestures?
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    // translateX is in terms of _input coords_
    const tx = useSharedValue(0);
    const savedTx = useSharedValue(0);
    // Collect data keys... Is there a better way to do this?
    // TODO: Performance-optimize this?
    const _dataKeys = new Set();
    React.Children.forEach(children, (child) => {
        if (React.isValidElement(child)) {
            _dataKeys.add(child.props.dataKey || "y");
        }
    });
    const massagedData = massageInputData(data, xKey, Array.from(_dataKeys));
    // Track canvas size
    const [size, setSize] = React.useState({ width: 0, height: 0 });
    const onLayout = React.useCallback(({ nativeEvent: { layout } }) => {
        setSize(layout);
    }, []);
    // Track tooltip state
    const [isTracking] = React.useState(false);
    const trackingX = useSharedValue(0);
    // View windows
    const _ixmin = useSharedValue(massagedData.x.at(0) || 0);
    const _ixmax = useSharedValue(massagedData.x.at(-1) || 0);
    const _width = useDerivedValue(() => _ixmax.value - _ixmin.value, [_ixmin, _ixmax]);
    const ixmin = useDerivedValue(() => _ixmin.value / scale.value + tx.value, [_ixmin, scale, tx]);
    const ixmax = useDerivedValue(() => _ixmax.value / scale.value + tx.value, [_ixmax, scale, tx]);
    const iymin = useSharedValue(getMinYFromMassagedData(massagedData));
    // const iymin = useSharedValue(0);
    const iymax = useSharedValue(getMaxYFromMassagedData(massagedData));
    const oxmin = useDerivedValue(() => valueFromPadding(padding, "left"), [padding]);
    const oxmax = useDerivedValue(() => size.width - valueFromPadding(padding, "right"), [size.width, padding]);
    const oymin = useDerivedValue(() => size.height - valueFromPadding(padding, "bottom"), [size.height, padding]);
    const oymax = useDerivedValue(() => valueFromPadding(padding, "top"), [padding]);
    // When the data changes, we need to update our raw input window
    React.useEffect(() => {
        _ixmin.value = withTiming(massagedData.x.at(0) || 0);
        _ixmax.value = withTiming(massagedData.x.at(-1) || 0);
        iymin.value = withTiming(getMinYFromMassagedData(massagedData), {
            duration: 300,
        });
        iymax.value = withTiming(getMaxYFromMassagedData(massagedData), {
            duration: 300,
        });
    }, [massagedData]);
    const value = React.useMemo(() => ({
        data: massagedData,
        inputWindow: {
            xMin: ixmin,
            xMax: ixmax,
            yMin: iymin,
            yMax: iymax,
        },
        outputWindow: {
            xMin: oxmin,
            xMax: oxmax,
            yMin: oymin,
            yMax: oymax,
        },
        tracking: {
            isActive: isTracking,
            x: trackingX,
        },
    }), [data, isTracking]);
    /**
     * Pinch to zoom
     */
    const pinchFocal = useSharedValue({ x: 0, relLeft: 0 });
    const pinch = Gesture.Pinch()
        .onBegin((e) => {
        // Where does our focal point map to in input coords?
        pinchFocal.value.x = map(e.focalX + oxmin.value, // take into account the padding
        oxmin.value, oxmax.value, ixmin.value, ixmax.value);
        // Focal point started at what % from left of window?
        pinchFocal.value.relLeft = e.focalX / (oxmax.value - oxmin.value);
    })
        .onUpdate((e) => {
        const s = savedScale.value * e.scale;
        scale.value = s;
        tx.value =
            _width.value * (1 - 1 / s) -
                (_ixmax.value - pinchFocal.value.x) +
                (1 - pinchFocal.value.relLeft) * (_width.value / s);
    })
        .onEnd(() => {
        const newScale = Math.max(1, scale.value);
        if (newScale !== scale.value)
            scale.value = withTiming(newScale, { duration: 300 });
        const newTx = clamp(tx.value, 0, _width.value - _width.value / newScale);
        if (newTx !== tx.value)
            tx.value = withTiming(newTx, { duration: 300 });
        savedTx.value = newTx;
        savedScale.value = newScale;
    });
    /**
     * Two-finger panning
     */
    const twoFingerDrag = Gesture.Pan()
        .onUpdate((e) => {
        const dx = ((ixmax.value - ixmin.value) / (oxmax.value - oxmin.value)) *
            e.translationX;
        tx.value = clamp(savedTx.value - dx, 0, _ixmax.value - _ixmin.value - (ixmax.value - ixmin.value));
    })
        .onEnd(() => {
        savedTx.value = tx.value;
    })
        .minPointers(2)
        .minDistance(5);
    /**
     * Single finger pan for tool-tipping
     * TODO: Disable when scrolling vertically
     */
    // const highlightPan = Gesture.Pan()
    //   .onBegin((evt) => {
    //     trackingX.value = map(
    //       evt.x + oxmin.value,
    //       oxmin.value,
    //       oxmax.value,
    //       ixmin.value,
    //       ixmax.value,
    //     );
    //     runOnJS(setIsTracking)(true);
    //   })
    //   .onUpdate((evt) => {
    //     trackingX.value = map(
    //       evt.x + oxmin.value,
    //       oxmin.value,
    //       oxmax.value,
    //       ixmin.value,
    //       ixmax.value,
    //     );
    //   })
    //   .onEnd(() => {
    //     runOnJS(setIsTracking)(false);
    //   });
    const combinedGesture = Gesture.Race(twoFingerDrag, pinch);
    return (React.createElement(GestureHandlerRootView, { style: { flex: 1 } },
        React.createElement(GestureDetector, { gesture: combinedGesture },
            React.createElement(Canvas, { style: { flex: 1 }, onLayout: onLayout },
                React.createElement(CartesianContext.Provider, { value: value }, children)))));
}
const valueFromPadding = (padding, side) => {
    "worklet";
    return typeof padding === "number" ? padding : padding?.[side] || 0;
};