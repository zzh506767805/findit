import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

import { colors } from '../theme';

const loadedSourceKeys = new Set();

function sourceKey(source) {
  if (!source) return '';
  if (typeof source === 'number') return `asset:${source}`;
  if (source.uri) return source.uri;
  return JSON.stringify(source);
}

export default function StableImage({ source, uri, style, imageStyle, resizeMode = 'cover', placeholderStyle }) {
  const nextSource = source || (uri ? { uri } : null);
  const nextKey = sourceKey(nextSource);
  const initiallyLoaded = Boolean(nextSource && (typeof nextSource === 'number' || loadedSourceKeys.has(nextKey)));
  const [current, setCurrent] = useState(nextSource);
  const [currentKey, setCurrentKey] = useState(nextKey);
  const [pending, setPending] = useState(null);
  const [loaded, setLoaded] = useState(initiallyLoaded);
  const opacity = useRef(new Animated.Value(initiallyLoaded ? 1 : 0)).current;

  useEffect(() => {
    if (!nextSource) {
      setCurrent(null);
      setCurrentKey('');
      setPending(null);
      setLoaded(false);
      opacity.setValue(0);
      return;
    }

    if (!current) {
      const cached = typeof nextSource === 'number' || loadedSourceKeys.has(nextKey);
      setCurrent(nextSource);
      setCurrentKey(nextKey);
      setPending(null);
      setLoaded(cached);
      opacity.setValue(cached ? 1 : 0);
      return;
    }

    if (nextKey !== currentKey) {
      if (loadedSourceKeys.has(nextKey)) {
        setCurrent(nextSource);
        setCurrentKey(nextKey);
        setPending(null);
        setLoaded(true);
        opacity.setValue(1);
        return;
      }
      setPending({ source: nextSource, key: nextKey });
    }
  }, [current, currentKey, nextKey, nextSource, opacity]);

  function showCurrent() {
    if (currentKey) loadedSourceKeys.add(currentKey);
    if (loaded) {
      opacity.setValue(1);
      return;
    }
    setLoaded(true);
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 140,
      useNativeDriver: true
    }).start();
  }

  function promotePending(loadedPending) {
    loadedSourceKeys.add(loadedPending.key);
    setCurrent(loadedPending.source);
    setCurrentKey(loadedPending.key);
    setPending(null);
    setLoaded(true);
    opacity.setValue(1);
  }

  return (
    <View style={[style, s.root]}>
      {current ? (
        <Animated.Image
          key={currentKey}
          source={current}
          resizeMode={resizeMode}
          onLoadEnd={showCurrent}
          style={[s.image, imageStyle, { opacity }]}
        />
      ) : null}
      {!loaded ? <View style={[s.placeholder, placeholderStyle]} /> : null}
      {pending ? (
        <Image
          key={`pending:${pending.key}`}
          source={pending.source}
          resizeMode={resizeMode}
          onLoadEnd={() => promotePending(pending)}
          style={s.pending}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    overflow: 'hidden',
    backgroundColor: colors.bgInput
  },
  image: {
    width: '100%',
    height: '100%'
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bgInput
  },
  pending: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0
  }
});
