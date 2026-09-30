export const EPSILON = 1e-9;
export const MAX_DEGREE = 24;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampPoint(point, bounds) {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

export function pointsEqual(a, b, tolerance = EPSILON) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
}

export function isInside(point, bounds) {
  return (
    point.x >= bounds.minX - EPSILON &&
    point.x <= bounds.maxX + EPSILON &&
    point.y >= bounds.minY - EPSILON &&
    point.y <= bounds.maxY + EPSILON
  );
}

export function evaluate(points, t) {
  const u = clamp(t, 0, 1);
  let work = points.map((point) => ({ ...point }));

  for (let degree = work.length - 1; degree > 0; degree -= 1) {
    const next = [];
    for (let i = 0; i < degree; i += 1) {
      next.push({
        x: (1 - u) * work[i].x + u * work[i + 1].x,
        y: (1 - u) * work[i].y + u * work[i + 1].y,
      });
    }
    work = next;
  }

  return work[0];
}

export function derivativePoints(points) {
  const degree = points.length - 1;
  if (degree <= 0) return [{ x: 0, y: 0 }];

  return points.slice(0, -1).map((point, index) => ({
    x: degree * (points[index + 1].x - point.x),
    y: degree * (points[index + 1].y - point.y),
  }));
}

export function derivative(points, t) {
  return evaluate(derivativePoints(points), t);
}

export function secondDerivative(points, t) {
  return derivative(derivativePoints(points), t);
}

export function tangent(points, t) {
  const velocity = derivative(points, t);
  const length = Math.hypot(velocity.x, velocity.y);
  if (length <= EPSILON) {
    const degree = points.length - 1;
    if (degree === 0) return { x: 1, y: 0 };
    const fallback = {
      x: points[degree].x - points[0].x,
      y: points[degree].y - points[0].y,
    };
    const fallbackLength = Math.hypot(fallback.x, fallback.y);
    return fallbackLength <= EPSILON
      ? { x: 1, y: 0 }
      : { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength };
  }
  return { x: velocity.x / length, y: velocity.y / length };
}

export function curvature(points, t) {
  if (points.length < 3) return { value: 0, signed: 0, radius: Infinity };

  const velocity = derivative(points, t);
  const acceleration = secondDerivative(points, t);
  const cross = velocity.x * acceleration.y - velocity.y * acceleration.x;
  const speed = Math.hypot(velocity.x, velocity.y);

  if (speed <= EPSILON) return { value: 0, signed: 0, radius: Infinity };

  const denominator = speed * speed * speed;
  const signed = cross / denominator;
  const value = Math.abs(signed);
  return {
    value,
    signed,
    radius: value > EPSILON ? 1 / value : Infinity,
  };
}

export function raiseDegree(points) {
  const degree = points.length - 1;
  const nextDegree = degree + 1;
  if (nextDegree > MAX_DEGREE) {
    throw new Error(`阶数不能超过 ${MAX_DEGREE} 阶`);
  }

  const raised = [{ ...points[0] }];
  for (let i = 1; i <= degree; i += 1) {
    const previousWeight = i / nextDegree;
    const currentWeight = 1 - previousWeight;
    raised.push({
      x: currentWeight * points[i].x + previousWeight * points[i - 1].x,
      y: currentWeight * points[i].y + previousWeight * points[i - 1].y,
    });
  }
  raised.push({ ...points[degree] });
  return raised;
}

export function lowerDegree(points) {
  const degree = points.length - 1;
  if (degree <= 1) {
    throw new Error('1 阶曲线已经是最低阶数');
  }

  const targetDegree = degree - 1;
  const variables = targetDegree - 1;
  const result = [
    { ...points[0] },
    ...Array.from({ length: variables }, () => ({ x: 0, y: 0 })),
    { ...points[degree] },
  ];

  if (variables > 0) {
    const matrix = Array.from({ length: variables }, () =>
      Array(variables).fill(0),
    );
    const rhsX = Array(variables).fill(0);
    const rhsY = Array(variables).fill(0);

    for (let row = 0; row <= degree; row += 1) {
      const entries = [];
      const previousWeight = row / degree;
      const currentWeight = (degree - row) / degree;
      if (row > 0) entries.push([row - 1, previousWeight]);
      if (row < degree) entries.push([row, currentWeight]);

      let fixedX = 0;
      let fixedY = 0;
      for (const [column, weight] of entries) {
        if (column === 0) {
          fixedX += weight * points[0].x;
          fixedY += weight * points[0].y;
        } else if (column === targetDegree) {
          fixedX += weight * points[degree].x;
          fixedY += weight * points[degree].y;
        }
      }

      for (const [column, weight] of entries) {
        if (column <= 0 || column >= targetDegree) continue;
        const k = column - 1;
        rhsX[k] += weight * (points[row].x - fixedX);
        rhsY[k] += weight * (points[row].y - fixedY);
        for (const [otherColumn, otherWeight] of entries) {
          if (otherColumn <= 0 || otherColumn >= targetDegree) continue;
          matrix[k][otherColumn - 1] += weight * otherWeight;
        }
      }
    }

    const solvedX = solveLinear(matrix, rhsX);
    const solvedY = solveLinear(matrix, rhsY);
    for (let i = 0; i < variables; i += 1) {
      result[i + 1] = { x: solvedX[i], y: solvedY[i] };
    }
  }

  const reconstructed = raiseDegree(result);
  let error = 0;
  for (let i = 0; i < points.length; i += 1) {
    error = Math.max(
      error,
      Math.hypot(
        points[i].x - reconstructed[i].x,
        points[i].y - reconstructed[i].y,
      ),
    );
  }

  return { points: result, error, exact: error <= 1e-7 };
}

export function split(points, t) {
  const u = clamp(t, 0, 1);
  const degree = points.length - 1;
  const left = [{ ...points[0] }];
  const right = Array(degree + 1);
  right[degree] = { ...points[degree] };

  let work = points.map((point) => ({ ...point }));
  for (let level = 1; level <= degree; level += 1) {
    const next = [];
    for (let i = 0; i <= degree - level; i += 1) {
      next.push({
        x: (1 - u) * work[i].x + u * work[i + 1].x,
        y: (1 - u) * work[i].y + u * work[i + 1].y,
      });
    }
    left.push({ ...next[0] });
    right[degree - level] = { ...next[degree - level] };
    work = next;
  }

  return {
    left,
    right,
    point: work[0],
  };
}

export function joinPair(first, second, t = 0.5) {
  if (first.length < 2 || second.length < 2) {
    throw new Error('至少需要两条有效曲线');
  }
  const u = clamp(t, 0, 1);
  const degree = Math.max(first.length - 1, second.length - 1);
  let firstPoints = first;
  let secondPoints = second;
  while (firstPoints.length - 1 < degree) firstPoints = raiseDegree(firstPoints);
  while (secondPoints.length - 1 < degree) secondPoints = raiseDegree(secondPoints);

  const equations = subdivisionCoefficients(degree, u);
  const observed = [...firstPoints, ...secondPoints];
  const columns = degree + 1;
  const normal = Array.from({ length: columns }, () =>
    Array(columns).fill(0),
  );
  const rhsX = Array(columns).fill(0);
  const rhsY = Array(columns).fill(0);

  equations.forEach((row, equationIndex) => {
    row.forEach((weight, column) => {
      rhsX[column] += weight * observed[equationIndex].x;
      rhsY[column] += weight * observed[equationIndex].y;
      row.forEach((otherWeight, otherColumn) => {
        normal[column][otherColumn] += weight * otherWeight;
      });
    });
  });

  const solvedX = solveLinear(normal, rhsX);
  const solvedY = solveLinear(normal, rhsY);
  const joined = solvedX.map((x, index) => ({ x, y: solvedY[index] }));
  const reconstructed = split(joined, u);
  let error = 0;
  const compare = (expected, actual) => {
    for (let i = 0; i < expected.length; i += 1) {
      error = Math.max(
        error,
        Math.hypot(expected[i].x - actual[i].x, expected[i].y - actual[i].y),
      );
    }
  };
  compare(firstPoints, reconstructed.left);
  compare(secondPoints, reconstructed.right);

  return {
    points: joined,
    degree,
    error,
    exact: error <= 1e-7,
  };
}

function subdivisionCoefficients(degree, t) {
  let rows = Array.from({ length: degree + 1 }, (_, index) => {
    const row = Array(degree + 1).fill(0);
    row[index] = 1;
    return row;
  });
  const left = [rows[0].slice()];
  const right = Array(degree + 1);
  right[degree] = rows[degree].slice();

  for (let level = 1; level <= degree; level += 1) {
    const next = [];
    for (let i = 0; i <= degree - level; i += 1) {
      const row = Array(degree + 1).fill(0);
      for (let column = 0; column <= degree; column += 1) {
        row[column] = (1 - t) * rows[i][column] + t * rows[i + 1][column];
      }
      next.push(row);
    }
    left.push(next[0].slice());
    right[degree - level] = next[degree - level].slice();
    rows = next;
  }

  return [...left, ...right];
}

export function sampleUniform(points, segments) {
  const count = Math.max(1, Math.floor(segments));
  const result = [];
  for (let i = 0; i <= count; i += 1) {
    result.push(evaluate(points, i / count));
  }
  return result;
}

export function sampleAdaptive(points, tolerance = 0.75, maxDepth = 18) {
  const output = [{ ...points[0] }];
  subdivideForSampling(
    points,
    tolerance,
    maxDepth,
    0,
    output,
  );
  return output;
}

function subdivideForSampling(points, tolerance, depth, currentDepth, output) {
  const last = points[points.length - 1];
  if (currentDepth >= depth || isFlat(points, tolerance)) {
    output.push({ ...last });
    return;
  }

  const parts = split(points, 0.5);
  subdivideForSampling(
    parts.left,
    tolerance,
    depth,
    currentDepth + 1,
    output,
  );
  subdivideForSampling(
    parts.right,
    tolerance,
    depth,
    currentDepth + 1,
    output,
  );
}

function isFlat(points, tolerance) {
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  for (let i = 1; i < points.length - 1; i += 1) {
    let distance;
    if (lengthSquared <= EPSILON) {
      distance = Math.hypot(points[i].x - start.x, points[i].y - start.y);
    } else {
      const cross =
        dx * (points[i].y - start.y) - dy * (points[i].x - start.x);
      distance = Math.abs(cross) / Math.sqrt(lengthSquared);
    }
    if (distance > tolerance) return false;
  }
  return true;
}

function solveLinear(matrix, values) {
  const size = matrix.length;
  const a = matrix.map((row, rowIndex) => [...row, values[rowIndex]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-14) {
      throw new Error('曲线方程无解，输入可能退化');
    }
    [a[column], a[pivot]] = [a[pivot], a[column]];

    for (let row = column + 1; row < size; row += 1) {
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= size; k += 1) {
        a[row][k] -= factor * a[column][k];
      }
    }
  }

  const solution = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = a[row][size];
    for (let column = row + 1; column < size; column += 1) {
      sum -= a[row][column] * solution[column];
    }
    solution[row] = sum / a[row][row];
  }
  return solution;
}
