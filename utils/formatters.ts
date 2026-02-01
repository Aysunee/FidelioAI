export const formatPrice = (price: number): string => {
    if (!price && price !== 0) return '0.00';

    if (price < 0.00001) return price.toFixed(8);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    if (price < 10) return price.toFixed(3);
    return price.toFixed(2);
};
