import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { createRoot } from 'react-dom/client';
import FieldMap from '../components/FieldMap';
import { loadAutoPathsFromAutoPath } from './pathLoader';

function getResolvedColor(cssVariable, fallback = '#1a1a1a') {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVariable).trim();
  return value || fallback;
}

async function captureElementAsImage(element) {
  if (!element) {
    throw new Error('html2canvas: Invalid element provided.');
  }
  // Give a slight delay for rendering to settle
  await new Promise(resolve => setTimeout(resolve, 100));
  const canvas = await html2canvas(element, {
    backgroundColor: getResolvedColor('--color-bg-surface'),
    useCORS: true,
    scale: 2,
  });
  return canvas.toDataURL('image/png');
}

function addFooter(doc, pageNumber, pageCount) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(150);

  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const footerText = `Generated on ${date}`;
  doc.text(footerText, margin, pageHeight - 10);

  const pageNumText = `Page ${pageNumber} of ${pageCount}`;
  doc.text(pageNumText, pageWidth - margin, pageHeight - 10, { align: 'right' });

  doc.setTextColor(0); // Reset text color
}

export async function generateAutoRoutinesPdf(routines) {
  if (!routines || routines.length === 0) {
    alert('No autonomous routines found to export.');
    return;
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'px',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const mapHeight = 150;

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(getResolvedColor('--color-text-primary', '#FFFFFF'));
  doc.text('Autonomous Routines', pageWidth / 2, margin + 20, { align: 'center' });

  let yPos = margin + 50;

  const renderContainer = document.createElement('div');
  renderContainer.style.position = 'fixed';
  renderContainer.style.left = '-9999px';
  renderContainer.style.top = '-9999px';
  renderContainer.style.width = '300px';
  renderContainer.style.height = 'auto';
  document.body.appendChild(renderContainer);
  const reactRoot = createRoot(renderContainer);

  for (const auto of routines) {
    const cardHeight = 250; // Approximate height for each routine card
    if (yPos + cardHeight > pageHeight - 30) { // Check space, leaving room for footer
      doc.addPage();
      yPos = margin;
    }

    const cardY = yPos;
    
    // Draw card background
    doc.setFillColor(getResolvedColor('--color-bg-card', '#2a2a2a'));
    doc.roundedRect(margin, cardY, contentWidth, cardHeight - 20, 5, 5, 'F');

    yPos += 20;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(getResolvedColor('--color-text-primary', '#FFFFFF'));
    doc.text(auto.name, pageWidth / 2, yPos, { align: 'center' });
    yPos += 18;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(getResolvedColor('--color-text-secondary', '#AAAAAA'));
    const descriptionLines = doc.splitTextToSize(auto.description, contentWidth - 20);
    doc.text(descriptionLines, pageWidth / 2, yPos, { align: 'center' });
    yPos += descriptionLines.length * 10 + 8;

    let mapImage;
    if (auto.isPreviewable) {
      const pathTarget = auto.autoPath || auto.name;
      const paths = await loadAutoPathsFromAutoPath(pathTarget);
      const mapElement = (
        <div style={{ width: '300px', height: '150px', background: getResolvedColor('--color-bg-surface') }}>
          <FieldMap pathSegments={paths} />
        </div>
      );
      reactRoot.render(mapElement);
      // Wait for the component to render
      await new Promise(resolve => setTimeout(resolve, 50));
      mapImage = await captureElementAsImage(renderContainer.firstChild);
    }

    const mapDisplayHeight = 120;
    const mapDisplayWidth = contentWidth - 40;
    const mapX = margin + (contentWidth - mapDisplayWidth) / 2;

    if (mapImage) {
      doc.addImage(mapImage, 'PNG', mapX, yPos, mapDisplayWidth, mapDisplayHeight);
    } else {
      doc.setDrawColor(getResolvedColor('--color-border', '#444444'));
      doc.setFillColor(getResolvedColor('--color-bg-surface', '#1a1a1a'));
      doc.roundedRect(mapX, yPos, mapDisplayWidth, mapDisplayHeight, 3, 3, 'F');
      doc.setTextColor(150, 150, 150);
      doc.setFontSize(10);
      doc.text('No Map Preview Available', pageWidth / 2, yPos + mapDisplayHeight / 2, { align: 'center' });
    }
    
    doc.setTextColor(0); // Reset text color
    yPos = cardY + cardHeight + 10; // Add significant space between cards
  }

  // Go back and add footers to all pages now that we know the total page count
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    addFooter(doc, i, pageCount);
  }

  reactRoot.unmount();
  document.body.removeChild(renderContainer);

  doc.save('NFR_Autonomous_Routines.pdf');
}
